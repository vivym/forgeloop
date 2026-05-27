# Product Architecture And Visual Rebuild Design

## Status

User-approved design draft.

This spec defines a deeper product architecture and visual rebuild for ForgeLoop Web after the product-grade visual-system closure landed and still failed the manual product-quality review.

The project is not launched. Implementation must favor the correct product architecture and frontend architecture over compatibility. Do not preserve the current generic `WorkspacePage` composition, card-heavy first viewports, legacy generic owner language for typed work, old/new switches, route aliases, or placeholder/demo-looking page structures when they conflict with this spec.

This spec supersedes the visual and information-architecture direction of:

- `docs/superpowers/specs/2026-05-23-project-management-ia-authoring-design.md` where it requires top-level Tasks or old Dashboard behavior;
- `docs/superpowers/specs/2026-05-23-ai-native-project-management-ux-redesign-design.md` where later product decisions narrowed Task extraction;
- `docs/superpowers/specs/2026-05-25-product-grade-visual-system-closure-design.md` where the resulting implementation retained a generic page-template shape.

It does not supersede the PRD's delivery loop, AI-native execution principles, traceability, review, QA, release, or future evolution-loop goals.

## Context

ForgeLoop's Web UI now has the right broad route families and a Tailwind-first component layer, but the manual visual review showed that the product still looks like an engineering demo:

- `Cockpit`, `My Work`, source-object lists, and `Development Plans` all share the same visible first-viewport template: current state, role, blocker/risk, next action, and a large state banner.
- Important work queues are pushed below explanatory blocks, empty-state banners, and low-specificity status cards.
- Empty in-memory demo data dominates the visual impression, making the app look unseeded and unfinished.
- Large pastel warning/success panels visually overstate ordinary state, and sometimes contradict the actual signal.
- Filters and controls occupy large blocks instead of behaving like mature toolbar controls.
- Repeated list items are rendered as generic bordered cards instead of dense, scan-friendly rows.
- `WorkspacePage` behaves as a visual design decision rather than a neutral page shell, causing every page family to look alike.

The original product intent was not "apply a shared template everywhere." It was a mature AI-native project-management system inspired by Linear's operational density, Notion's document/database editing model, and BI-style reporting where appropriate. ForgeLoop's differentiator is not visual mimicry; it is the governed AI-native delivery flow from typed source objects through Development Plans, Plan Items, Superpowers-style brainstorming, Spec, Execution Plan, AI execution, code review, QA, release, and observation.

## Goals

- Rebuild the product-facing information architecture around the actual AI-native delivery loop.
- Remove the current generic `WorkspacePage` visual pattern from product pages.
- Make page families visually and structurally distinct:
  - Cockpit as an operational command center;
  - My Work as a role inbox with inspector;
  - source objects as database/document workspaces;
  - Development Plans as table-first planning workspaces;
  - Plan Items as governed gate workspaces;
  - execution/review/QA/release as supervision and readiness workspaces;
  - reports as intelligence surfaces.
- Establish seeded demo data as a mandatory product-quality input for local preview and screenshot review.
- Make visual acceptance test real workflow density, not empty states.
- Keep source objects typed. Requirements, Bugs, Tech Debt, and Initiatives are different product objects, not a single generic Work Item surface.
- Preserve the approved product flow:

  `Source Object -> Development Plan -> Plan Item -> Brainstorming -> Spec + Execution Plan -> AI Execution -> Code Review -> QA -> Release`

- Keep Plan Item as the governed unit for Spec, Execution Plan, and execution in this rebuild.
- Defer structured executable Task extraction. Execution Plan documents remain the source for executable steps until a future spec introduces a first-class structured task list.
- Produce a product UI that is clean, dense, calm, and credible enough to evaluate as a real project-management system.

## Non-Goals

- No full backend domain rewrite.
- No Evolution Loop or learning-rule authoring in this slice.
- No external Jira, Linear, GitHub Issues, Notion, or document-system sync.
- No real-time collaborative editing.
- No generic custom-field builder.
- No compatibility shell, old/new switch, or legacy route alias.
- No top-level generic Work Items page.
- No public generic owner product surface for typed source objects or Plan Items. Use typed driver, responsible role, reviewer, QA, and release-specific responsibility language instead.
- No top-level Tasks route in this rebuild.
- No direct source-object to Spec or source-object to Execution Plan generation.
- No direct Codex execution from unapproved Development Plan content, incomplete brainstorming, draft Spec, or draft Execution Plan.
- No raw Execution Package, Run Session, Review Packet, trace, replay, or runtime object browser in primary navigation.
- No decorative marketing hero layout, gradient blobs, emoji icons, one-note palette, or card sprawl.

## Product Object Architecture

### Product Object Hierarchy

ForgeLoop Web must present a layered object model:

1. **Project Context**
   - Current project, role lens, actor identity, and runtime readiness.
   - This is global context, not the primary content of each page.
2. **Source Objects**
   - Initiative, Requirement, Bug, Tech Debt.
   - These capture the "why" and typed source context.
3. **Development Plan**
   - A product planning container for one or more source objects.
   - It may be manually authored or AI-assisted, but it must look like a normal development planning table.
4. **Plan Item**
   - The smallest governed unit for boundary clarification, Spec, Execution Plan, execution, review, QA, and release linkage.
5. **Brainstorming Session**
   - Superpowers-style boundary clarification attached to a Plan Item.
6. **Spec Document**
   - Technical boundary and acceptance document generated or edited after brainstorming approval.
7. **Execution Plan Document**
   - Superpowers-style implementation plan document generated after Spec approval.
8. **Execution**
   - Product-facing supervision over Codex worker work.
9. **Code Review / QA Handoff**
   - Human judgment and quality gates.
10. **Release**
   - Readiness, risk, rollout, evidence, and observation.
11. **Reports**
   - Delivery, quality, release-readiness, and observation intelligence.

### Source Objects Are Typed

The UI must not treat all source objects as one generic object. Each typed source object has different information gravity:

| Type | Primary editor | Primary information | Default layout emphasis |
| --- | --- | --- | --- |
| Initiative | Product / Manager | business objective, scope, milestones, value, linked source objects | roadmap and linked plan coverage |
| Requirement | Product | stakeholder problem, desired outcome, acceptance criteria, linked plans | document plus properties |
| Bug | QA / Bug Driver / Developer | impact, reproduction, environment, severity, regression evidence | triage, fix path, verification |
| Tech Debt | Tech Lead / Developer | affected surface, risk, payoff, migration strategy | risk and engineering health |

All roles can read Requirements. Product is the primary editor for Requirement narrative and acceptance. Tech Lead, Developer, QA, Release, and Manager views should prioritize their relevant signals through filters, columns, and inspector panels, not through duplicated pages.

### No-Baggage Typed Ref Contract

The PRD's Work Item abstraction is represented in ForgeLoop Web as typed source objects. Public product surfaces must never fall back to a generic Work Item identity.

Rules:

- Public routes, navigation, table rows, inspector rows, action payloads, query filters, DTOs, evidence projections, and screenshot labels must use typed source refs:
  - `initiative`;
  - `requirement`;
  - `bug`;
  - `tech_debt`.
- Cross-object links must combine typed source refs with explicit Development Plan, Plan Item, Spec revision, Execution Plan revision, execution, review, QA, and Release refs where applicable.
- Generic `work_item` identifiers are forbidden at public product boundaries. They may remain inside repository/storage mapping, internal domain services, runtime Execution Package linkage, RunSpec/package/run records, release/evidence backfill, and migration internals when required by the current data model.
- Any internal generic `work_item` mapping that reaches Web/query/API product projections must project outward as typed source refs plus Development Plan, Plan Item, Spec revision, Execution Plan revision, execution, review, QA, and Release refs where applicable.
- Public text must use `Driver`, `responsible role`, `reviewer`, `QA`, or Release-specific responsibility language. It must not reintroduce a generic owner concept for source objects or Plan Items.
- Release-specific responsibility language is allowed only inside Release surfaces.

### Development Plan

Development Plan is the planning bridge between source objects and execution. It is not synonymous with an AI-generated artifact.

Rules:

- A Development Plan can be manually created.
- A Development Plan can be AI-assisted after source context is selected.
- A Development Plan can link multiple source objects when a delivery slice spans them.
- A Development Plan contains Plan Items.
- A Development Plan must expose table-first planning, source links, responsible roles, risks, gates, and plan-item state.
- A Development Plan must not directly create Spec or Execution Plan documents except through a selected Plan Item.

### Plan Item

Plan Item is the governed work unit for this rebuild.

Plan Item fields required for product UI:

- title;
- summary;
- source refs;
- responsible role;
- driver actor or role where accountability is required;
- reviewer actor or role;
- risk;
- affected surfaces/repos/modules;
- dependency hints;
- boundary status;
- Spec status;
- Execution Plan status;
- execution status;
- code review status;
- QA handoff status;
- release impact;
- next action;
- blocked reason;
- evidence and artifact links.

Plan Item is not the same as a structured executable Task. Structured task extraction from an Execution Plan document is deferred until a future spec. In this rebuild, the Execution Plan document carries the detailed executable step list, and the Plan Item carries the product/gate lifecycle.

### Spec And Execution Plan Documents

Spec and Execution Plan are item-scoped documents.

Rules:

- Spec generation is disabled until the Plan Item has an approved boundary summary from brainstorming.
- Execution Plan generation is disabled until the Plan Item has an approved Spec.
- Execution is disabled until the Plan Item has an approved Execution Plan.
- Document routes must look like document review workspaces with properties and gate context, not raw Markdown files or runtime logs.

### Execution, Review, QA, And Release

Execution Package, Run Session, Review Packet, and internal runtime data remain execution-layer objects. They are still authoritative for runtime execution, review evidence, QA evidence, release control, and traceability. They are not primary product navigation objects. Users should enter through Plan Item, Executions, My Work, Release, or Reports.

### Product Vs Runtime Authority Mapping

This spec does not remove the PRD's Execution Package execution authority. It changes the product entry point and visual hierarchy.

Authority rules:

- Product/gate authority is:
  - typed source object refs;
  - Development Plan;
  - Plan Item;
  - approved boundary summary;
  - approved Spec revision;
  - approved Execution Plan revision.
- The product label `Execution Plan` is the Web product label for the PRD Implementation Plan artifact in this slice.
- Runtime enqueue must create or link an internal Execution Package before a Codex worker run starts.
- Each internal Execution Package must carry, at minimum:
  - source refs;
  - `development_plan_id`;
  - `development_plan_item_id`;
  - `spec_revision_id`;
  - `execution_plan_revision_id`;
  - runtime policy/check requirements;
  - changed-file and test evidence links after execution;
  - review, QA, and Release linkage where available.
- Plan Item may supervise one or more internal Execution Packages when implementation must split across repos, surfaces, contracts, or release units.
- Execution Package must not appear as a primary navigation destination or raw object browser, but developer-facing execution evidence must be visible from Plan Item execution, Executions, My Work, Release, and Reports.
- Execution is disabled unless the Plan Item can truthfully resolve to an approved Spec revision, an approved Execution Plan revision, and a runnable internal Execution Package boundary.

Execution pages must show:

- current worker/run status;
- current step and last event;
- resumability and interrupt/continue controls;
- changed files and checks as evidence;
- code review readiness;
- QA handoff readiness;
- release impact.

Release pages must show:

- release scope;
- included source objects and Plan Items;
- readiness blockers;
- QA/Test evidence;
- rollout and rollback plan;
- observation signals.

## Information Architecture

### Primary Navigation

Primary navigation groups:

- Workspace:
  - Cockpit;
  - My Work.
- Discovery:
  - Initiatives;
  - Requirements;
  - Bugs;
  - Tech Debt.
- Planning:
  - Development Plans;
  - Document Reviews.
- Delivery:
  - Board;
  - Executions;
  - Releases.
- Intelligence:
  - Reports.
- Tools:
  - Dev Tools only in explicit development mode.

Do not add a top-level Work Items, Tasks, Dashboard, Packages, Runs, Reviews, Replay, standalone Plans, or standalone Specs navigation item. `/specs-plans` is the only approved item-scoped Spec and Execution Plan governance queue, and its visible navigation label must be `Document Reviews`.

### Route Ownership

| Route family | Product meaning | Required layout |
| --- | --- | --- |
| `/` | Cockpit entry | redirect/render `/cockpit` |
| `/cockpit` | operational command center | cockpit grid |
| `/my-work` | role inbox | inbox + table + inspector |
| `/initiatives`, `/requirements`, `/bugs`, `/tech-debt` | typed source object database views | database toolbar + dense table + optional preview |
| `/initiatives/new`, `/requirements/new`, `/bugs/new`, `/tech-debt/new` | typed source object authoring | document editor + property panel |
| `/initiatives/:id`, `/requirements/:id`, `/bugs/:id`, `/tech-debt/:id` | typed source object detail | document + properties + linked plans |
| `/initiatives/:id/evidence`, `/requirements/:id/evidence`, `/bugs/:id/evidence`, `/tech-debt/:id/evidence` | source evidence | evidence summary + attachments + raw details below |
| `/development-plans` | planning table index | dense plan list/table |
| `/development-plans/new` | plan authoring/generation | source context + AI assist + preview |
| `/development-plans/:id` | plan table | table-first workspace + inspector |
| `/development-plans/:id/items/:itemId` | Plan Item gate hub | gate workspace |
| `/development-plans/:id/items/:itemId/brainstorming` | boundary clarification | conversational Q/A + decisions + approval |
| `/development-plans/:id/items/:itemId/spec` | Spec review | document review workspace |
| `/development-plans/:id/items/:itemId/execution-plan` | Execution Plan review | document review workspace |
| `/development-plans/:id/items/:itemId/execution` | execution supervision | run status + evidence |
| `/development-plans/:id/items/:itemId/review` | code review handoff | review workspace + evidence |
| `/development-plans/:id/items/:itemId/qa` | QA handoff | QA workspace + acceptance evidence |
| `/specs-plans` | item-scoped document governance queue | grouped queue + inspector |
| `/board` | cross-object delivery flow | gate/status board |
| `/executions` | execution supervision lanes | lanes/table hybrid |
| `/executions/:id` | execution detail | supervision detail |
| `/releases`, `/releases/:id` | release readiness | readiness cockpit |
| `/releases/:id/evidence` | release evidence | readiness evidence workspace |
| `/reports`, `/reports/*` | intelligence | BI/report layout |
| `/dashboard`, `/tasks`, `/work-items`, `/packages`, `/runs`, `/reviews`, raw replay routes | retired or dev-only | no product surface |

Routes not listed here must be classified in the implementation plan before coding. Query parameters, hash fragments, tabs, selected report modes, or view modes that change the product surface are canonical route states and must be listed in Route Ownership plus Screenshot Review, or explicitly rejected/dev-only. `/reports?report=replay` is retired from the product surface in this rebuild and must be removed or gated behind explicit development mode.

### Page-Family Layout Contract

Every primary route must declare exactly one page family and render family-owned first-viewport composition. The contract must be testable through DOM landmarks or equivalent stable selectors.

| Page family | Required stable landmarks | Geometry target | Above-the-fold primary surface | Forbidden first-viewport behavior |
| --- | --- | --- | --- | --- |
| Shell | `data-app-shell`, `data-sidebar-nav`, `data-topbar`, `data-command-search` | route page family's `data-primary-work-surface`, not shell chrome | navigation and command context only | route-specific state summary in shell |
| Cockpit | `data-page-family="cockpit"`, `data-command-strip`, `data-attention-queue`, `data-risk-column`, `data-health-rail` | `data-attention-queue data-primary-work-surface` | attention queue plus blocker/execution/review/QA work | generic state banner before queues |
| My Work | `data-page-family="inbox"`, `data-inbox-toolbar`, `data-inbox-list`, `data-inspector-panel` | `data-inbox-list data-primary-work-surface` | role-filtered queue/table with selected-item inspector | one empty table per role or large disabled-action panels |
| Source Object Database | `data-page-family="source-database"`, `data-database-toolbar`, `data-data-table`, `data-row-preview` when selected | `data-data-table data-primary-work-surface` | dense table with typed rows | filter cards above the table or generic object cards |
| Source Object Document | `data-page-family="source-document"`, `data-document-surface`, `data-property-rail`, `data-attachment-strip` | `data-document-surface data-primary-work-surface` | document editor/viewer plus property rail | raw Markdown dump or card stack before document |
| Source Evidence | `data-page-family="source-evidence"`, `data-evidence-summary`, `data-attachment-list`, `data-raw-evidence-details` | `data-evidence-summary data-primary-work-surface` | evidence summary plus attachment/evidence list | generic raw details before summarized evidence |
| Development Plan Table | `data-page-family="planning-table"`, `data-planning-toolbar`, `data-plan-items-table`, `data-inspector-panel` | `data-plan-items-table data-primary-work-surface` | Plan Item table and selected row inspector | plan cards as the main surface |
| Development Plan Authoring | `data-page-family="plan-authoring"`, `data-source-context-picker`, `data-ai-assist-panel`, `data-plan-preview` | `data-source-context-picker data-primary-work-surface` or `data-plan-preview data-primary-work-surface` after generation | source context selection plus plan draft preview | AI prompt card as the whole page |
| Plan Item Gate | `data-page-family="gate-flow"`, `data-gate-stepper`, `data-gate-workspace`, `data-context-rail` | `data-gate-workspace data-primary-work-surface` | active gate workspace plus compact gate progress | summary-template block before the active gate |
| Document Review | `data-page-family="document-review"`, `data-document-surface`, `data-review-toolbar`, `data-review-state`, `data-comment-summary` | `data-document-surface data-primary-work-surface` | Spec or Execution Plan document body | runtime logs as the primary document surface |
| Code Review Workspace | `data-page-family="code-review"`, `data-code-review-workspace`, `data-review-evidence`, `data-review-decision-controls` | `data-code-review-workspace data-primary-work-surface` | review packet summary, requested changes, evidence, decision controls | generic lower-card review section only |
| QA Handoff Workspace | `data-page-family="qa-handoff"`, `data-qa-handoff-workspace`, `data-qa-acceptance-evidence`, `data-qa-decision-controls` | `data-qa-handoff-workspace data-primary-work-surface` | QA acceptance evidence, risks, and handoff controls | generic lower-card QA section only |
| Document Governance Queue | `data-page-family="document-governance"`, `data-document-queue`, `data-document-review-groups`, `data-inspector-panel` | `data-document-queue data-primary-work-surface` | grouped Spec/Execution Plan review queue plus inspector | standalone `/specs` or `/plans` surface |
| Delivery Board | `data-page-family="delivery-board"`, `data-board-columns`, `data-board-card`, `data-board-toolbar` | `data-board-columns data-primary-work-surface` | Plan Item gate board | generic task kanban or card-only dashboard |
| Execution Supervision | `data-page-family="execution-supervision"`, `data-execution-lanes`, `data-run-evidence`, `data-worker-controls` | `data-execution-lanes data-primary-work-surface` or `data-run-evidence data-primary-work-surface` on detail | active/waiting/resumable execution lanes or run detail | raw package/run object browser |
| Release Readiness | `data-page-family="release-readiness"`, `data-release-scope`, `data-readiness-blockers`, `data-qa-evidence`, `data-rollout-plan` | `data-readiness-blockers data-primary-work-surface` or `data-release-scope data-primary-work-surface` | release scope plus blockers/evidence | generic report links instead of readiness evidence |
| Release Evidence | `data-page-family="release-evidence"`, `data-release-evidence-summary`, `data-release-evidence-list`, `data-release-raw-evidence` | `data-release-evidence-summary data-primary-work-surface` | release evidence summary plus QA/test artifacts | raw details before readiness evidence |
| Report Insight | `data-page-family="report-insight"`, `data-report-conclusion`, `data-report-signals`, `data-recommended-actions` | `data-report-conclusion data-primary-work-surface` | conclusion, signals, affected objects, action | generic list of report cards |

Additional rules:

- The primary work surface must appear before explanatory state copy in DOM order and visual order.
- Geometry gates must measure the family-specific `data-primary-work-surface` target, not page headers, old summary wrappers, or shell chrome.
- Page-family layout components must own their first viewport. They must not delegate first-viewport composition to `WorkspacePage`, `PrioritySummary`, `ActionStrip`, or a shared summary-template wrapper.
- Reusable lower-level primitives are allowed only below the family composition boundary.
- Product routes must not use thin wrapper components whose only behavior is passing props into the old `WorkspacePage` visual template.
- Product route first-viewport tests must reject the old acceptance markers `data-first-viewport`, `data-priority-summary`, `data-action-strip`, `current-state`, `role-responsibility`, `blocker-risk`, and `next-action`.

## Visual Direction

### Visual Baseline

The global baseline is **Linear-first operational SaaS**:

- compact left navigation;
- dense object lists;
- table-first planning;
- quick filters and views;
- row selection and inspector panels;
- restrained borders;
- small status accents;
- clear typography;
- minimal decorative styling.

Use **Notion-like patterns** only for:

- source-object detail;
- source-object authoring;
- Spec and Execution Plan documents;
- properties and linked-object panels;
- Markdown/MDX editing.

Use **BI/report patterns** only for:

- Reports;
- release readiness summaries;
- management intelligence sections.

### Design System Rules

Use a strict 8px spacing system and a 12-column responsive grid for desktop page composition.

Recommended token direction:

- background: neutral off-white, not blue-gray heavy;
- surface: white for real panels only;
- border: subtle gray with stronger selected row border;
- primary accent: one operational blue/cyan family;
- status colors: green, amber, red, info used in small semantic indicators, not large pastel blocks by default;
- radius: mostly 6-8px;
- shadows: only overlays, dropdowns, popovers, drawers, active inspector surfaces;
- typography: Inter or Plus Jakarta Sans, no viewport-scaled fonts, no negative letter spacing;
- iconography: lucide icons where useful, no emoji icons.

Avoid:

- page sections styled as floating cards;
- card-in-card composition;
- large colored notice banners as routine state;
- text paragraphs explaining what the UI is instead of showing the work;
- wide blank surfaces;
- generic "Report 1" labels;
- repeated empty tables for every role or state.

## Page Family Designs

### Shell

The shell should feel like a mature workspace:

- left nav is compact and stable;
- active nav state is subtle but clear;
- topbar prioritizes command search, role lens, project switcher/context, and actor menu;
- runtime/dev indicators are compact secondary badges;
- content width uses predictable responsive constraints;
- no page header should consume more than necessary vertical space.

### Cockpit

Cockpit is an operational command center, not a generic dashboard and not a metric wall.

Desktop layout:

- top row: compact command strip with role lens, primary next action, and high-risk count;
- left major column: role-selected attention queue;
- center major column: blockers, stale gates, active executions, review/QA gates;
- right inspector/rail: compact health indicators, release readiness, recent activity;
- lower sections: reports and trend exploration.

Rules:

- If there are no blockers, do not show a large "blocked" warning panel.
- Metrics must be attached to decisions or queues.
- Report links must have meaningful labels and destinations.
- Empty data must show a product-start workflow, not a generic empty state.

### My Work

My Work is a role inbox.

Desktop layout:

- toolbar: role, status, gate, risk, search, view options;
- left rail or grouped list: role attention groups with counts;
- main table/list: only relevant items, dense rows;
- right inspector: selected item, why visible, next action, disabled reason, linked object, evidence.

Rules:

- Do not render large empty tables for every role.
- Disabled bulk actions should appear as compact explanatory text or be hidden, not as large no-op action panels.
- Rows must expose concrete object type and gate, not generic item text.

### Source Object Database Views

Initiatives, Requirements, Bugs, and Tech Debt share a database/list frame but differ by fields and defaults.

Desktop layout:

- top: title, primary create action, view selector, compact filters;
- main: dense table with sticky header;
- optional right preview pane when a row is selected;
- empty state: compact workflow prompt with create and plan actions.

Rules:

- Filters live in a toolbar, not a separate large panel.
- The table is the primary surface even when empty.
- Preview pane appears only when useful and must not push the table below the fold on desktop.
- Requirements default columns prioritize problem/outcome, phase, risk, Development Plan link, next action.
- Bugs default columns prioritize severity, reproduction, affected surface, fix plan, verification.
- Tech Debt default columns prioritize affected surface, risk, payoff, plan link, driver or responsible role.
- Initiatives default columns prioritize outcome, scope, milestone, plan coverage, status.

### Source Object Detail And Authoring

Use a document/database hybrid.

Desktop detail layout:

- document column: narrative, acceptance/reproduction/context sections, attachments;
- property rail: status, risk, driver, role, source type, linked Development Plans, Plan Items, releases, evidence;
- top action strip: create/link Development Plan, add to existing Development Plan, view evidence;
- lower tabs/drawers: evidence, revisions, timeline, related objects.

Authoring layout:

- MDXEditor-backed narrative;
- structured property panel;
- image insertion through attachments/evidence;
- validation summary near the action bar;
- unsaved-state handling.

### Document Editing Contract

Document editing is a first-class UX requirement for source-object authoring/detail and for Spec and Execution Plan review routes.

Required behavior:

- Use an MDXEditor-backed document surface on:
  - `/initiatives/new`, `/requirements/new`, `/bugs/new`, `/tech-debt/new`;
  - `/initiatives/:id`, `/requirements/:id`, `/bugs/:id`, `/tech-debt/:id` when the actor has edit permission;
  - `/development-plans/:id/items/:itemId/spec`;
  - `/development-plans/:id/items/:itemId/execution-plan`.
- Provide rich editing and source/Markdown modes.
- Provide toolbar affordances for heading, bold, italic, list, link, code, table, image, undo/redo, and preview when supported by the editor package.
- Support image insertion by paste, drag/drop, and file picker.
- Image insertion creates an attachment/evidence record with:
  - attachment id;
  - linked object or document revision ref;
  - filename;
  - content type;
  - byte size;
  - alt text;
  - optional caption;
  - pending/uploaded/error state.
- Inserted images must render in the document body through stable attachment refs, not temporary blob URLs after save.
- Dirty state must be visible and must guard navigation away from unsaved edits.
- Save/submit/approve actions must stay separate. Saving a draft must not imply submitting for review or approving a gate.
- Preview/render must sanitize unsafe script content and preserve code blocks, tables, links, and image refs.
- Failed upload/save states must keep local editor content recoverable.

### Development Plans

Development Plans must look like a mature planning product, not a card list.

Index layout:

- compact toolbar with create, AI-assisted generate, source filter, role/gate/risk/status filters;
- active plans table;
- selected plan preview or side rail;
- compact empty state with seeded demo guidance.

Detail layout:

- table-first body;
- sticky header;
- visible Plan Item gates;
- selected row inspector;
- actions: add row, generate missing rows, regenerate selected rows, start brainstorming, view context manifest.

Rules:

- Source object selection must come from real query data or seeded demo data.
- No hard-coded fake source IDs in product code.
- AI generation is an action, not the whole page.

### Plan Item Gate Workspace

Plan Item detail is the workflow hub for a single governed delivery unit.

Desktop layout:

- left/main: current gate workspace;
- top compact gate progress;
- right inspector: source context, roles, evidence, dependencies, risk, release impact;
- tabs or focus routes for Brainstorming, Spec, Execution Plan, Execution, Review, QA.

Gate order:

`Boundary -> Spec -> Execution Plan -> Execution -> Code Review -> QA -> Release`

Each gate shows:

- status;
- driver or responsible role;
- next action;
- disabled reason;
- evidence;
- links to generated artifacts.

### Brainstorming

Brainstorming is a first-class product flow, not a hidden generation step.

Required UI:

- context manifest summary;
- question/answer transcript;
- unresolved questions;
- recorded decisions;
- boundary summary;
- approve/request revision actions;
- provenance of actor and Codex runtime where available.

### Spec And Execution Plan Review

Spec and Execution Plan focus routes use document review workspace patterns:

- document body;
- review state;
- approver/reviewer;
- comment/change request summary;
- version/revision selector;
- generate/regenerate/submit/approve/request changes actions.

### Executions

Executions use supervision lanes:

- active;
- waiting for input;
- interrupted/resumable;
- failed;
- review-ready;
- completed/recent.

Execution detail shows run state, current step, last event, checks, changed files, artifacts, review handoff, QA handoff, and continue/interrupt controls.

### Board

Board is a delivery-flow board over Plan Items and gates, not a generic task kanban.

Columns should represent meaningful delivery states:

- Planning;
- Boundary;
- Spec;
- Execution Plan;
- Running;
- Review;
- QA;
- Release.

Cards must be compact and show title, source type, responsible role, risk, current gate, and next action.

### Releases

Release pages are readiness cockpits:

- scope;
- included source objects and Plan Items;
- readiness blockers;
- QA/Test evidence;
- risk and overrides;
- rollout/rollback;
- observation.

### Reports

Reports use BI/intelligence layout:

- conclusion first;
- signal and trend second;
- affected objects;
- recommended action;
- supporting details lower.

Reports must not look like generic lists of links.

## Seeded Demo Data

Seeded demo data is mandatory for this rebuild.

### Purpose

The product must be reviewed in a realistic state:

- multiple source object types;
- at least one active Development Plan;
- multiple Plan Items at different gates;
- one active/resumable execution;
- one Spec review item;
- one Execution Plan review item;
- one QA handoff;
- one release readiness scenario;
- reports with meaningful labels and signals.

### Requirements

- Provide a deterministic local demo seed path that does not require Postgres on fixed ports.
- The seed path must work with the in-memory/demo repository or a configurable database URL.
- The local preview command must not assume port 5432, 15432, or 25432.
- The product-review preview command must default to the seeded in-memory repository, choose free API/Web ports, print both URLs, and print the active seed id.
- Database-backed preview may be supported through an explicit configurable `DATABASE_URL`, but it must not be required for visual review.
- Demo object IDs must be stable for screenshots.
- Demo text must be realistic and product-specific. Avoid labels like "Report 1" or "No matching objects" in main screenshot routes.
- Empty-state routes must still be tested separately.

### Demo Scenario

Create the following deterministic seeded scenario at minimum:

| Object | Stable id | Required visible label | Required state |
| --- | --- | --- | --- |
| Project | `project-product-architecture-demo` | `ForgeLoop product architecture demo` | active |
| Initiative | `init-ai-native-rollout` | `AI-native project management rollout` | linked to the Development Plan |
| Requirement | `req-plan-item-governance` | `Plan Item governed Spec and Execution Plan generation` | accepted for planning, with MDX narrative and image attachment |
| Bug | `bug-execution-review-context` | `Execution continuation loses review context` | high severity, reproduction attached |
| Tech Debt | `td-retire-workspace-page-template` | `Retire generic WorkspacePage visual template` | risk accepted, linked to visual rebuild plan |
| Development Plan | `dp-product-architecture-visual-rebuild` | `Project architecture and visual rebuild` | active |
| Plan Item | `dpi-cockpit-command-center` | `Rebuild Cockpit into operational command center` | Spec review |
| Plan Item | `dpi-requirements-database-view` | `Replace Requirements list with database view` | Execution Plan approved |
| Plan Item | `dpi-demo-seed-visual-review` | `Seed demo project state for visual review` | execution running/resumable |
| Plan Item | `dpi-development-plan-table-inspector` | `Rewrite Development Plan table and inspector` | boundary blocked on unresolved question |
| Spec revision | `specrev-cockpit-command-center-v1` | `Cockpit operational command center Spec` | pending approval |
| Execution Plan revision | `planrev-requirements-database-view-v1` | `Requirements database view Execution Plan` | approved |
| Execution Package | `pkg-demo-seed-visual-review-v1` | `Seed demo project state execution boundary` | internal runtime package linked to running execution |
| Execution | `exec-demo-seed-visual-review` | `Codex worker is seeding visual review data` | active/resumable |
| Code Review | `review-cockpit-requested-changes` | `Requested changes on Cockpit layout density` | requested changes |
| QA handoff | `qa-requirements-authoring-mdx` | `QA pending MDX image insertion acceptance` | pending acceptance |
| Release | `rel-product-architecture-preview` | `Product architecture preview release` | readiness blocked |
| Report | `report-delivery-risk` | `Delivery risk: visual rebuild blocked by generic template debt` | contains conclusion, signal, and recommended action |

Required attachments/evidence:

- `att-requirement-flow-image`: attached to `req-plan-item-governance`, image alt text `Plan Item generation flow`.
- `att-bug-reproduction-screenshot`: attached to `bug-execution-review-context`, image alt text `Continuation loses review context`.
- `evidence-exec-demo-seed-checks`: linked to `exec-demo-seed-visual-review`, shows changed files and checks.

Required route-visible seed expectations:

- `/cockpit` shows `Seed demo project state for visual review`, `Requested changes on Cockpit layout density`, and `Product architecture preview release`.
- `/requirements` shows `Plan Item governed Spec and Execution Plan generation` and its linked Development Plan.
- `/requirements/:id` shows the MDX narrative, `Plan Item generation flow`, and create/link Development Plan actions.
- `/bugs` shows `Execution continuation loses review context`, severity, reproduction state, and fix plan linkage.
- `/tech-debt` shows `Retire generic WorkspacePage visual template`, affected surface, risk, payoff, and driver/responsible role.
- `/development-plans` and `/development-plans/:id` show all four Plan Items with distinct gate states.
- `/development-plans/:id/items/:itemId` shows the gate order, disabled reasons, source refs, runtime package evidence when available, and next action.
- `/development-plans/:id/items/:itemId/review` shows `Requested changes on Cockpit layout density`, review evidence, requested changes, and decision controls.
- `/development-plans/:id/items/:itemId/qa` shows `QA pending MDX image insertion acceptance`, acceptance evidence, unresolved QA risks, and handoff controls.
- `/executions` shows `Codex worker is seeding visual review data` in an active/resumable lane.
- `/releases/:id` shows readiness blockers, QA evidence, rollout, rollback, and observation signals.
- `/reports/*` shows meaningful report labels, conclusions, signals, affected objects, and recommended actions.

## Frontend Architecture

### Replace Generic Visual Template

`WorkspacePage` may remain only as a semantic shell for landmarks and responsive content constraints. It must not render a mandatory first-viewport summary pattern for every page family.

`WorkspacePage` must not render, own, or require product-route first-viewport content such as generic current-state summaries, role responsibility summaries, blocker/risk banners, next-action strips, or page-family-specific work surfaces. Existing wrappers that only pass props into `WorkspacePage` must be deleted or rewritten for product routes.

New page family components should own their visual composition:

- `CockpitLayout`;
- `InboxLayout`;
- `DatabaseViewLayout`;
- `DocumentWorkspaceLayout`;
- `PlanningTableLayout`;
- `GateFlowLayout`;
- `ExecutionSupervisionLayout`;
- `ReleaseReadinessLayout`;
- `ReportInsightLayout`.

These components may share lower-level primitives:

- `Topbar`;
- `SidebarNav`;
- `Toolbar`;
- `FilterBar`;
- `DataTable`;
- `InspectorPanel`;
- `ActionBar`;
- `StatusDot`;
- `GateStepper`;
- `DocumentSurface`;
- `PropertyList`;
- `EvidenceList`;
- `EmptyWorkflowState`;
- `Skeleton`.

### Presentation View Models

Continue using feature-level presentation adapters, but strengthen them around page-family needs:

- `cockpitViewModel`;
- `myWorkInboxViewModel`;
- `sourceObjectDatabaseViewModel`;
- `sourceObjectDetailViewModel`;
- `developmentPlanTableViewModel`;
- `planItemGateViewModel`;
- `executionSupervisionViewModel`;
- `releaseReadinessViewModel`;
- `reportInsightViewModel`.

Adapters must derive UI-priority shapes from real projections and seeded demo data. They must not hide missing data behind generic success states.

### Backend Projection Boundary

Backend/API changes are allowed only when a required product state cannot be truthfully derived from current projections.

Allowed projection changes:

- read-only fields needed for linked object counts;
- meaningful next-action labels;
- blocked reason;
- gate timestamps;
- stable demo seed projections;
- source-object to Development Plan link summaries.

Disallowed changes:

- rewriting core lifecycle semantics;
- adding compatibility fields for old UI;
- making Task a top-level product object in this slice;
- changing runtime execution authority without a separate runtime spec.

## Verification And Acceptance

### Design Acceptance

A route passes visual review only if:

- the first viewport shows actual work or a realistic workflow entry, not generic state explanation;
- page family layout is distinct and appropriate;
- primary actions are visually obvious but not oversized;
- secondary metadata is compact;
- status color is semantic and small unless a true blocking state needs attention;
- no repeated empty tables dominate the page;
- no route looks like the current generic `WorkspacePage` template;
- no generic "Report 1" or placeholder labels appear in screenshot routes;
- the seeded demo scenario renders meaningful data.

### Measurable Layout Gates

Playwright or equivalent browser checks must assert layout geometry in addition to DOM content.

Minimum gates:

- At 1440x900 and 1024x768, the primary work surface for each route must start within the first 220px below the app topbar.
- Every measured route must expose exactly one visible `data-primary-work-surface` element from its page-family contract.
- Geometry checks must fail if they measure `data-first-viewport`, header content, shell chrome, `data-priority-summary`, `data-action-strip`, or text-only summary markers instead of the family primary work surface.
- On table/list routes, the primary table/list must occupy at least 45% of the visible content viewport area on desktop.
- On document routes, the editor or rendered document surface must occupy at least 50% of the visible content viewport area on desktop.
- Routine state, readiness, or empty-workflow banners must not exceed 72px height on desktop unless a true blocking state is selected.
- Page headers must not exceed 96px height on desktop.
- Filter controls must fit in a toolbar row of 56px height at widths >= 1024px; overflow may use menus, not a second large panel.
- The primary work surface must be visible before explanatory copy at 375px mobile width.
- No primary route may create horizontal page scroll at 375px, 768px, 1024px, or 1440px widths.
- Selected-row inspectors must be visible on desktop when seeded data includes a selected row; on mobile they must collapse to a drawer or below-content panel without pushing the primary content out of the first viewport.
- Product routes must not render the old first-viewport summary-template markers, `PrioritySummary`, or `ActionStrip`.

### Automated Tests

Required tests:

- route contract rejects retired primary routes;
- route/query contract rejects retired product modes such as `/reports?report=replay` unless they are explicitly reclassified with full Route Ownership and Screenshot Review coverage;
- seeded demo data creates expected object graph;
- navigation contains only approved primary entries;
- every Route Ownership entry maps to exactly one page-family contract with required stable landmarks and a visible `data-primary-work-surface`;
- public URL, DTO, queue-row, action-payload, and evidence-projection tests reject generic `work_item` refs outside allowed internal storage/domain/runtime/backfill/migration mappings;
- public UI/DTO text tests reject generic owner language for source objects and Plan Items while allowing Release-specific responsibility language inside Release surfaces;
- runtime mapping tests prove execution start links Plan Item, approved Spec revision, approved Execution Plan revision, and internal Execution Package before a worker run starts;
- Cockpit has operational layout landmarks and no generic summary-template marker;
- My Work renders one inbox table/list plus inspector, not one empty table per role;
- source object lists render database toolbar and dense table;
- Development Plans render table-first layout and selected inspector;
- Plan Item gate workspace renders gate order and disabled reasons;
- Plan Item review and QA routes render code-review and QA handoff landmarks with the seeded review and QA records;
- authoring routes use MDXEditor wrapper and attachment/image insertion path;
- source-object detail, Spec review, and Execution Plan review routes cover rich/source mode, image paste/drop/file-picker insertion, attachment refs, alt/caption metadata, dirty-state guard, and failed upload/save recovery;
- reports render conclusion/signal/action structure;
- page-family routes expose the required stable landmarks and do not render the old generic first-viewport summary components;
- geometry checks enforce the measurable layout gates against the family `data-primary-work-surface`;
- responsive checks at 375, 768, 1024, and 1440;
- a11y checks for visible labels, focus, and non-color-only states.

### Screenshot Review

Screenshot manifest must cover every canonical product route listed in Route Ownership. Parameterized routes must use the seeded ids from this spec, not placeholder params.

- `/`;
- `/cockpit`;
- `/my-work`;
- `/initiatives`;
- `/initiatives/new`;
- `/initiatives/init-ai-native-rollout`;
- `/initiatives/init-ai-native-rollout/evidence`;
- `/requirements`;
- `/requirements/new`;
- `/requirements/req-plan-item-governance`;
- `/requirements/req-plan-item-governance/evidence`;
- `/bugs`;
- `/bugs/new`;
- `/bugs/bug-execution-review-context`;
- `/bugs/bug-execution-review-context/evidence`;
- `/tech-debt`;
- `/tech-debt/new`;
- `/tech-debt/td-retire-workspace-page-template`;
- `/tech-debt/td-retire-workspace-page-template/evidence`;
- `/development-plans`;
- `/development-plans/new`;
- `/development-plans/dp-product-architecture-visual-rebuild`;
- `/development-plans/dp-product-architecture-visual-rebuild/items/dpi-cockpit-command-center`;
- `/development-plans/dp-product-architecture-visual-rebuild/items/dpi-development-plan-table-inspector/brainstorming`;
- `/development-plans/dp-product-architecture-visual-rebuild/items/dpi-cockpit-command-center/spec`;
- `/development-plans/dp-product-architecture-visual-rebuild/items/dpi-requirements-database-view/execution-plan`;
- `/development-plans/dp-product-architecture-visual-rebuild/items/dpi-demo-seed-visual-review/execution`;
- `/development-plans/dp-product-architecture-visual-rebuild/items/dpi-cockpit-command-center/review`;
- `/development-plans/dp-product-architecture-visual-rebuild/items/dpi-requirements-database-view/qa`;
- `/specs-plans`;
- `/executions`;
- `/executions/exec-demo-seed-visual-review`;
- `/board`;
- `/releases`;
- `/releases/rel-product-architecture-preview`;
- `/releases/rel-product-architecture-preview/evidence`;
- `/reports`;
- `/reports/delivery`;
- `/reports/quality`;
- `/reports/release-readiness`;
- `/reports/observation`.

Screenshots must use seeded demo data, not an empty repository state. Empty-state screenshots may be captured as a separate manifest.

Query-mode screenshots are required only for query states that remain product-visible. Retired/dev-only query states, including `/reports?report=replay`, must be covered by route/query rejection tests instead of screenshot review.

Screenshot closure must produce a checked report artifact under `docs/superpowers/reports/` containing, for every required route and viewport:

- route;
- viewport;
- seeded project id;
- selected object id where applicable;
- screenshot path or artifact reference;
- DOM landmark results;
- geometry gate results;
- visible seeded labels;
- known empty-state coverage, if applicable;
- product-review decision: pass, needs fix, or blocked;
- exact blocker notes for every failed route.

Merge is blocked unless every required seeded screenshot route has meaningful seeded data, passes the measurable layout gates, and has an explicit product-review pass decision. A test-only visual pass without screenshot artifacts and manual product-review decisions is insufficient for this rebuild.

### Manual Review Checklist

Before merge, the implementer must answer:

- Does Cockpit look like an operational command center?
- Does My Work look like a role inbox?
- Do Requirements, Bugs, Tech Debt, and Initiatives look like typed database/document objects?
- Does Development Plans look like a planning table?
- Does Plan Item detail clearly communicate the governed AI-native gate flow?
- Are Spec and Execution Plan review surfaces document-centered?
- Do Reports look like intelligence surfaces?
- Which current `WorkspacePage` visual assumptions were removed?
- Which empty states remain, and why are they not the default visual evidence?

## Implementation Boundaries

Expected code areas:

- `apps/web/src/shared/styles/theme.css`;
- `apps/web/src/shared/layout/**`;
- `apps/web/src/shared/ui/**`;
- `apps/web/src/shared/navigation/**`;
- `apps/web/src/app/routes/**`;
- `apps/web/src/features/**`;
- `packages/db/src/**` only for demo seed/read projection gaps;
- `apps/control-plane-api/src/modules/**` only for read projection or seed exposure gaps;
- `tests/web/**`;
- `tests/api/**`;
- `tests/db/**`;
- `tests/e2e/**`;
- `docs/superpowers/reports/**`.

Avoid:

- unrelated executor/runtime safety changes;
- parallel worktree-owned features;
- compatibility routes;
- old/new UI switches;
- broad backend lifecycle rewrites;
- introducing first-class Tasks before a dedicated task-extraction spec.

## Implementation Phases

1. **Product Architecture Contract**
   - route ownership;
   - retired routes;
   - object hierarchy;
   - no top-level Tasks/Work Items;
   - no-baggage typed refs;
   - Product vs Runtime authority mapping;
   - page family registry.
2. **Seeded Demo Scenario**
   - deterministic local seed;
   - stable IDs;
   - required object graph from this spec;
   - screenshot data readiness;
   - no fixed Postgres port dependency.
3. **Visual System Foundation**
   - tokens;
   - shell;
   - low-level primitives;
   - page-family layout contract;
   - measurable layout gates;
   - removal of generic `WorkspacePage` visual behavior.
4. **Workspace Entry Surfaces**
   - Cockpit;
   - My Work.
5. **Source Object Database And Document Surfaces**
   - Initiatives;
   - Requirements;
   - Bugs;
   - Tech Debt;
   - authoring and evidence routes;
   - MDXEditor document editing and image attachment contract.
6. **Planning And Gate Surfaces**
   - Development Plans index/new/detail;
   - Plan Item detail;
   - brainstorming;
   - Spec and Execution Plan document review.
7. **Delivery And Release Surfaces**
   - Board;
   - Executions;
   - execution detail;
   - Releases;
   - release evidence.
8. **Reports And Intelligence**
   - reports index;
   - delivery, quality, release-readiness, observation reports.
9. **Screenshot Closure And Manual Review**
   - seeded screenshot manifest;
   - empty-state manifest;
   - screenshot report artifact;
   - geometry gate evidence;
   - responsive/a11y verification;
   - blocker review fixes.

Each phase must have a checkpoint. Final screenshots cannot be the first time visual quality is evaluated.

## Risks And Mitigations

- Risk: C-level scope becomes an unbounded rewrite.
  - Mitigation: restrict backend changes to read projections and demo seed unless a blocker proves otherwise.
- Risk: the team reimplements the same generic page template under new component names.
  - Mitigation: tests and manual review must reject generic `WorkspacePage` summary-template markers on primary product routes.
- Risk: seeded demo data masks weak empty states.
  - Mitigation: maintain separate empty-state screenshot and test coverage.
- Risk: Task ambiguity returns.
  - Mitigation: Plan Item remains governed unit; structured executable task extraction is explicitly deferred.
- Risk: competitor inspiration becomes imitation.
  - Mitigation: borrow interaction patterns only; keep ForgeLoop's AI-native gate flow as the product structure.
- Risk: visual tests pass while pages still look poor.
  - Mitigation: require screenshot artifacts plus manual review checklist answers in the PR.

## Open Questions For Implementation Planning

- Which exact script name should own the one-command product-review preview flow?
- Which current `WorkspacePage` consumers can be deleted first while minimizing merge conflicts with parallel feature branches?
- Do any current query projections lack enough relationship summaries for database/inspector layouts?
- How should role lens state persist across routes: URL query, local storage, or actor context?

## References

- PRD: `docs/PRD_v1.md`
- Prior UX spec: `docs/superpowers/specs/2026-05-23-ai-native-project-management-ux-redesign-design.md`
- Prior IA/authoring spec: `docs/superpowers/specs/2026-05-23-project-management-ia-authoring-design.md`
- Prior visual closure spec: `docs/superpowers/specs/2026-05-25-product-grade-visual-system-closure-design.md`
- Current implementation review: `docs/superpowers/reports/product-grade-visual-system-closure-review.md`
- Product pattern references: Linear operational density, Notion document/database workspace, GitHub Projects table/board views, Jira Product Discovery discovery-to-delivery planning, BI report information hierarchy.
