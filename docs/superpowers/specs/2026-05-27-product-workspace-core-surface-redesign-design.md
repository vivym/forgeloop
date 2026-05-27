# Product Workspace Core Surface Redesign Design

## Status

User-approved design draft.

This spec defines the next ForgeLoop Web redesign pass after `2026-05-26-product-architecture-visual-rebuild-design.md` was implemented and still failed manual product-quality review. The previous pass moved the product in the right direction, but the current UI still looks like a generic project-management demo rather than a mature AI-native delivery workspace.

The project is not launched. Correct product architecture, information architecture, and frontend architecture take priority over compatibility. Implementation must remove the remaining generic page-template behavior, generic source-object language, and low-signal status panels where they conflict with this spec. Do not preserve historical UI structure merely because it already exists.

This spec supersedes the four-core-surface layout direction from:

- `docs/superpowers/specs/2026-05-23-ai-native-project-management-ux-redesign-design.md`;
- `docs/superpowers/specs/2026-05-25-product-grade-visual-system-closure-design.md`;
- `docs/superpowers/specs/2026-05-26-product-architecture-visual-rebuild-design.md`.

It does not supersede the PRD, typed source-object model, Development Plan / Plan Item product flow, Superpowers-style brainstorming gate, Spec and Execution Plan approval gates, Codex execution supervision, review, QA, release, or future evolution-loop goals.

## Context

Manual review of the current preview at `/cockpit`, `/requirements`, `/development-plans`, and `/development-plans/:developmentPlanId/items/:itemId` shows that ForgeLoop now has the right route families and data model direction, but the product surface still has these blockers:

- **Cockpit is not a command center.** It renders attention queues, reports, metrics, and gate snippets as similar bordered blocks. It does not tell a manager, tech lead, developer, or QA which decision needs attention first.
- **Requirements still look generic.** The page is labeled `Requirements`, but the reusable `ObjectList` renders "source object database", "Create source object", "Plan source object", "Requirement summary unavailable", and `Responsibility: actor-owner`. This undercuts the typed Requirement model and the product role expectation that Product primarily edits Requirements while all roles can read them.
- **Development Plans are table-shaped but not yet a planning workspace.** The page has filters and a table, but it does not yet present plan coverage, row health, linked source-object context, AI-assisted generation state, and selected Plan Item details with the density and polish of mature planning tools.
- **Plan Item detail has the right lifecycle but the wrong workspace shape.** It vertically stacks route chrome, state banners, metadata, gate progress, gate cards, actions, revision history, and evidence. It must instead behave like a governed Plan Item workspace where one current gate dominates the center, adjacent gates stay visible but compact, and evidence/activity/decision context lives in a side rail.
- **Shared layout primitives are still acting as visual decisions.** `ProductPage`, `SurfaceStateIndicator`, `Section`, `CockpitLayout`, `DatabaseViewLayout`, `PlanningTableLayout`, and `GateFlowLayout` encourage each page family to look alike. Shared primitives must provide structure and accessibility, not impose identical first-viewport composition.
- **Low-value state is overemphasized.** Large approved/blocked banners and repeated explanatory text consume more visual attention than the actual work queue, requirement narrative, planning table, or current gate.
- **The seeded demo is too thin.** Many surfaces show one row and "unavailable" copy. A premium workflow product must preview realistic density: multiple Requirements, at least one Bug, one Tech Debt item, multiple Development Plans, multiple Plan Items in different gate states, active execution, review requested changes, QA pending, and release readiness blockers.

ForgeLoop's target product is not a Jira clone, a Notion clone, or a Linear clone. It must borrow mature layout discipline from those products:

- Linear-style calm navigation, dense queues, small status marks, and strong current action hierarchy.
- Notion-style document plus properties for typed source objects and Spec / Execution Plan authoring.
- GitHub Projects / Jira Product Discovery style planning tables with inspectors, coverage, filters, and linked delivery state.
- AI-native workflow controls that are native to ForgeLoop: context collection, brainstorming questions, boundary approval, Spec generation, Execution Plan generation, Codex execution, interrupt/continue, review, QA, and release readiness.

## Goals

- Make the four core surfaces feel like one coherent AI-native project-management product:
  - Cockpit;
  - Requirements;
  - Development Plans;
  - Plan Item Detail and its gate routes.
- Replace the remaining generic page-template feel with page-family-specific layouts.
- Keep Requirements typed and role-aware: Product edits narrative and acceptance; tech lead, developer, QA, release, and manager read and act through their relevant signals.
- Make Development Plan the central planning workspace between typed source objects and Plan Items.
- Make Plan Item the governed delivery workspace for Brainstorming, Spec, Execution Plan, Execution, Code Review, and QA.
- Make all first viewports prioritize real work: decisions, blockers, current gate, plan coverage, linked objects, and next actions.
- Keep UI calm, dense, and clean: small status marks, compact rows, restrained color, crisp borders, no decorative hero treatment, no card sprawl, no card-in-card layouts.
- Establish a frontend architecture that prevents future pages from slipping back into one generic `WorkspacePage` or generic `ObjectList` shape.
- Require screenshot-based acceptance against seeded realistic data at desktop and mobile widths.

## Non-Goals

- No Evolution Loop / retrospective learning implementation in this slice.
- No external Jira, Linear, GitHub Issues, Notion, or document-system sync.
- No real-time collaborative editing.
- No generic custom-field builder.
- No top-level generic Work Items page.
- No top-level Tasks route.
- No structured executable task extraction from Execution Plan documents.
- No direct Requirement/Bug/Tech Debt/Initiative to Spec generation.
- No direct source-object to Execution Plan generation.
- No direct execution from Development Plan content, incomplete brainstorming, draft Spec, or draft Execution Plan.
- No raw Execution Package, Run Session, Review Packet, trace, replay, or runtime object browser in primary navigation.
- No public generic Work Item Owner or generic source-object owner language.
- No compatibility shell, old/new switch, legacy route family, or fallback generic page renderer.
- No decorative marketing hero layout, oversized KPI cards, gradient blobs, emoji icons, one-note palette, or ornamental visuals.

## Product Principles

### Typed Objects, Not Generic Work Items

The PRD uses Work Item as an abstraction, but the product UI must expose typed source objects:

- Initiative;
- Requirement;
- Bug;
- Tech Debt.

Each type has distinct information gravity and role focus. Requirements are not Bugs. Bugs are not Tech Debt. Tech Debt is not an Initiative. Public UI copy, actions, filters, table headings, inspectors, empty states, breadcrumbs, and command items must use typed names.

Forbidden public labels in this redesign:

- `source object` when the route already knows the typed object;
- `Work Item Owner`;
- generic `owner` for typed source objects or Plan Items;
- `Task` as a first-class object in this slice;
- `Package`, `Run`, `Review Packet`, or `Trace` as primary navigation labels.

Allowed responsibility language:

- `Requirement Driver`;
- `Initiative Driver`;
- `Bug Driver`;
- `Tech Debt Driver`;
- `Plan Item Driver`;
- `Responsible role`;
- `Reviewer`;
- `QA`;
- `Release owner` inside Release-specific surfaces.

### Development Plan Is The Planning Bridge

No source object can skip directly to Spec, Execution Plan, or execution. The product flow remains:

`Typed Source Object -> Development Plan -> Plan Item -> Brainstorming -> Spec -> Execution Plan -> Codex Execution -> Code Review -> QA -> Release`

Development Plan must look like a normal development planning table that can be manually authored or AI-assisted. AI generation is an action on the planning workspace, not the whole product metaphor.

### Plan Item Is The Governed Delivery Workspace

Plan Item is the smallest product unit that can move through:

`Boundary brainstorming -> Spec review -> Execution Plan review -> Execution supervision -> Code review -> QA handoff -> Release readiness`

Plan Item is not an executable task list. Execution Plan documents continue to carry detailed executable steps until a future spec introduces structured task extraction.

### Product Entry And Runtime Authority

This redesign changes the product entry point and visual hierarchy. It does not remove the PRD's Execution Package execution authority.

Authority rules:

- Product/gate authority is carried by typed source refs, Development Plan, Plan Item, approved Boundary Summary, approved Spec revision, and approved Execution Plan revision.
- The Web product label `Execution Plan` is the product-facing name for the PRD Implementation Plan artifact in this slice.
- Runtime enqueue must create or link an internal Execution Package before a Codex worker run starts.
- Every runtime Execution Package created from a Plan Item must carry source refs, `development_plan_id`, `development_plan_item_id`, `spec_revision_id`, `execution_plan_revision_id`, policy/check requirements, changed-file evidence, test evidence, review linkage, QA linkage, and release linkage where available.
- A Plan Item may supervise one or more internal Execution Packages when implementation must split across repos, surfaces, contracts, release units, or verification boundaries.
- Execution Package, Run Session, Review Packet, trace, and replay objects remain authoritative internal execution/evidence objects, but they must not become primary navigation or raw object-browser surfaces.
- Developer-facing execution evidence from those runtime objects must remain visible from Plan Item execution, Executions, My Work, Release, and Reports.
- Execution is disabled unless the Plan Item resolves to an approved Spec revision, an approved Execution Plan revision, and a runnable internal Execution Package boundary.

### Page Families Must Be Structurally Distinct

Shared layout code may provide primitives, but these product families must not collapse into the same first viewport:

- Cockpit: command center.
- Requirements: typed document/database workspace.
- Development Plans: planning table and inspector.
- Plan Item Detail: gate workspace including release readiness context.

The implementation must remove or rewrite shared abstractions that force identical structure across these surfaces.

### Real Work Beats Explanatory UI

The first viewport must show the user's immediate work, not a large explanation of the page's purpose. Headings, subtitles, state banners, and helper copy must be compact. The core object list/table/document/current gate must be visible without scrolling on a 1280x720 viewport.

## Target Visual System

Use a professional enterprise SaaS style:

- base background: cool neutral, not pastel-dominant;
- surfaces: white or near-white with 1px borders;
- radius: 6-8px;
- typography: Inter or Plus Jakarta Sans, small hierarchy, no viewport-scaled type;
- color: restrained blue/cyan accent plus semantic green/amber/red; semantic color must not be the only signal;
- spacing: dense 4/8/12/16px rhythm;
- status: small pills, dots, row accents, and inline labels before large banners;
- icons: lucide icons only where they clarify actions or status;
- tables: sticky headers, tight rows, row hover, selected row background, visible focus ring, horizontal scroll on small widths;
- panels: split panes and side rails, not nested cards;
- empty states: compact and contextual, never dominating seeded preview pages.

The UI must avoid:

- large pastel success panels for normal approved/current states;
- repeated bordered cards for every line item;
- card-in-card page sections;
- decorative gradients or blobs;
- emoji icons;
- one-hue purple/blue theme;
- giant hero-like page headers;
- text labels that describe how to use the UI instead of showing the actual workflow.

## Core Surface Designs

### 1. Cockpit

#### Product Job

Cockpit answers: "What needs attention now, and who must decide?"

It is for managers, tech leads, developers, QA, and release owners who need a fast operational view across the project.

#### Required Layout

Desktop first viewport:

- left: priority attention queue, grouped by role lens and severity;
- center: delivery flow strip showing counts by lifecycle stage;
- right: risk/readiness rail with release blockers, review aging, QA blockers, and stale context;
- top toolbar: project, role lens, command search, runtime status, compact create/action menu.

The attention queue must be the dominant surface. Metrics support decisions; they must not dominate over the queue.

#### Required Content

Cockpit must show:

- top 3-7 attention items with typed refs and clear next action;
- active/resumable Codex executions;
- Spec and Execution Plan review aging;
- Plan Items blocked by missing boundary, missing Spec approval, missing Execution Plan approval, requested code-review changes, or QA blockers;
- release readiness blockers;
- stale/degraded data warnings only when real and compact;
- links to My Work, Development Plan, Plan Item, Execution, Review, QA, or Release as appropriate.

#### Required Actions

Cockpit actions must route to the object where work happens. It must not host full editing flows.

Examples:

- Continue execution;
- Review Spec;
- Review Execution Plan;
- Resolve code-review changes;
- Create QA handoff;
- Inspect release blocker.

#### Remove From Current Implementation

- Report links named `Report 1`, `Report 2`, or generic report follow-up rows.
- Large approved/blocked state banner as a normal first-viewport element.
- Equal visual weight for metrics and urgent action rows.
- Generic health metadata that consumes more space than the queue.

### 2. Requirements

#### Product Job

Requirements answers: "What product outcomes exist, what is their narrative, and how do they feed planning?"

Requirements are visible to all roles, but Product is the primary editor for requirement narrative, desired outcome, acceptance criteria, and scope.

#### Required Layout

Index page:

- database toolbar with search, status, priority, risk, driver, planning coverage, release link, and view controls;
- dense table as the main surface;
- optional right inspector for the selected Requirement;
- compact create and generate/link Development Plan actions in the toolbar or inspector.

Detail page:

- document editor in the center using MDXEditor-backed Markdown authoring;
- property panel on the right with driver, priority, risk, status, linked Development Plans, evidence, attachments, releases, and audit data;
- Development Plan coverage section below or in right rail;
- clear action to create/link/generate a Development Plan from the Requirement.

#### Required Content

Requirement rows must show:

- title;
- Requirement Driver;
- priority;
- risk;
- status;
- linked Development Plan coverage;
- Plan Item coverage;
- current downstream gate summary;
- last meaningful update;
- next action.

Requirement inspector must show:

- stakeholder problem;
- desired outcome;
- acceptance criteria summary;
- in scope / out of scope summary;
- linked Development Plans and Plan Items;
- evidence and attachments;
- release references;
- next action.

#### Required Actions

- Create Requirement;
- edit narrative;
- attach image/file evidence through existing attachment flow;
- create Development Plan;
- generate Development Plan draft with AI;
- link existing Development Plan;
- open linked Plan Item.

#### Remove From Current Implementation

- `Requirements source object database`;
- `Create source object`;
- `Plan source object`;
- `Requirement summary unavailable` as the default seeded impression;
- generic `Responsibility: actor-owner`;
- a bottom planning state section that repeats the selected row instead of adding value.

### 3. Development Plans

#### Product Job

Development Plans answers: "How will source objects be split into governed Plan Items, and what is each Plan Item's delivery state?"

This is the main planning bridge. It must feel like a serious project-management table, not a generated artifact list.

#### Required Layout

Index page:

- compact summary bar: total plans, active plans, blocked items, review aging, execution in progress;
- filter toolbar: source type, role, driver, reviewer, gate, risk, release impact, status;
- dense table of Development Plans;
- selected-plan preview rail when viewport supports it.

Plan detail page:

- table-first Plan Item workspace;
- sticky toolbar with Add row, AI generate missing rows, Regenerate with guidance, show context manifest;
- selected Plan Item inspector on the right;
- plan coverage rail or compact header showing linked Requirements/Bugs/Tech Debt/Initiatives;
- inline editing for safe Plan Item fields when available.

#### Required Content

Development Plan table rows must show:

- plan title;
- linked source objects;
- item count;
- blocked count;
- current distribution across boundary/spec/execution/review/QA;
- primary responsible roles;
- risk;
- status;
- updated date.

Plan Item rows must show:

- Plan Item title;
- source refs;
- current gate;
- gate progress;
- risk;
- driver;
- responsible role;
- reviewer;
- affected surfaces;
- dependencies;
- release impact;
- next action.

Inspector must show:

- selected Plan Item summary;
- current gate and blocker;
- next action;
- linked source object context;
- Spec / Execution Plan / execution / review / QA links;
- evidence summary;
- compact action buttons.

#### Required Actions

- Create Development Plan manually;
- generate Development Plan draft from source context with AI;
- add Plan Item row;
- regenerate missing rows with guidance;
- preserve prior decisions during regeneration;
- open Plan Item;
- start/continue brainstorming where allowed;
- generate Spec only after approved boundary;
- generate Execution Plan only after approved Spec;
- start execution only after approved Execution Plan.

#### Remove From Current Implementation

- oversized success state banner for normal loaded state;
- table rows that wrap into tall blocks at desktop width;
- generic "row" terminology in user-facing copy where `Plan Item` is clearer;
- inspector copy that says source context/evidence is unavailable in seeded preview;
- filters that consume a full row but do not include driver/reviewer/planning coverage.

### 4. Plan Item Detail And Gate Routes

#### Product Job

Plan Item Detail answers: "Where is this governed delivery unit, what gate is active, what context supports the decision, and what action is allowed now?"

It is primarily for tech lead, developer, reviewer, QA, and release-facing workflows.

#### Required Layout

All Plan Item routes share a gate workspace shell:

- top compact identity row: Plan Item title, source refs, current gate, risk, driver, responsible role, reviewer, release impact;
- left or upper compact gate rail: Boundary, Spec, Execution Plan, Execution, Code Review, QA, Release;
- center main workspace: current gate content only;
- right rail: evidence, decisions, activity, context manifest, linked artifacts;
- bottom or collapsed section: revision history and secondary evidence.

The overview route must not render every gate body fully. It must show the current gate as primary, with adjacent gates as compact status cards or rail entries.

#### Gate-Specific Requirements

Brainstorming:

- show questions, answers, decisions, context manifest, boundary summary, and approval state;
- show which questions still need human input;
- enable Spec generation only after approved boundary.

Spec:

- document review workspace;
- MDXEditor-backed draft/edit state with attachments and images;
- visible approval status and reviewer comments;
- generate/submit/approve/request changes actions separated by gate eligibility.

Execution Plan:

- same document review workspace pattern as Spec;
- clear distinction from Development Plan;
- execution enablement only after approval.

Execution:

- worker status;
- current step and last event;
- interrupt/continue controls;
- changed files and verification evidence;
- PR/diff links where available.

Code Review:

- review decision panel;
- requested changes and audited exception path where allowed;
- verification evidence and changed surfaces.

QA:

- QA handoff status;
- acceptance criteria;
- test strategy;
- verification evidence;
- block/accept decision path.

Release:

- release linkage and release impact;
- readiness blockers that still depend on this Plan Item;
- included Release refs and rollout/rollback context where available;
- QA/Test evidence required for release inclusion;
- action to open the owning Release or release readiness surface.

#### Required Actions

- Start/continue brainstorming;
- approve boundary;
- generate Spec;
- submit Spec for review;
- approve/request changes/reject Spec;
- generate Execution Plan;
- submit Execution Plan for review;
- approve/request changes/reject Execution Plan;
- start/interrupt/continue execution;
- mark ready for code review;
- approve/request changes in code review;
- create QA handoff;
- block or accept QA handoff;
- open or update release readiness linkage where the Plan Item has release impact.

Actions must be eligible only when upstream gates are satisfied. Disabled actions must explain the missing gate in one compact line.

#### Remove From Current Implementation

- large `Development Plan Item Detail: Approved state` banner;
- route chrome that consumes first-viewport space without adding current-gate value;
- overview route that renders all gate bodies sequentially;
- duplicated `Gate progress` sections;
- lifecycle action blocks that read like an API command inventory instead of a contextual decision panel;
- evidence timeline placeholder text as a primary visible block.

## Frontend Architecture

### Replace Generic Page Composition With Page-Specific Shells

Implementation must stop treating `ProductPage` as the core page design. `ProductPage` may remain as a small semantic wrapper only if it does not impose first-viewport spacing, headers, or generic toolbar layout.

Required page-specific shells:

- `CockpitCommandCenter`;
- `RequirementWorkspace`;
- `DevelopmentPlanWorkspace`;
- `PlanItemGateWorkspace`.

These shells must own the visible layout for the four core surfaces. Shared layout primitives can be extracted only after the page-specific shape is clear.

### Split Typed Source Object UI

`ObjectList` currently makes Requirements, Bugs, Tech Debt, and Initiatives look too similar. This redesign must remove generic source-object UI for all typed source-object route families, not only Requirements.

Implementation must:

- replace `ObjectList` with typed database/workspace adapters for Requirements, Initiatives, Bugs, and Tech Debt; or
- split `ObjectList` into a neutral table engine plus typed page adapters where all copy, columns, inspectors, empty states, and actions come from typed adapters.

Minimum typed adapters:

- `RequirementDatabase` / `RequirementWorkspace`;
- `InitiativeDatabase` / `InitiativeWorkspace`;
- `BugDatabase` / `BugWorkspace`;
- `TechDebtDatabase` / `TechDebtWorkspace`.

The implementation must not leave any typed source-object route with generic `source object` text, generic owner language, generic create/plan action labels, or generic unavailable summaries as the dominant seeded impression.

### Keep Shared Components Primitive

Allowed shared primitives:

- table engine;
- split pane;
- inspector rail;
- property list;
- gate rail;
- toolbar controls;
- status pill;
- action menu;
- document editor;
- evidence drawer.

Forbidden shared abstractions:

- generic page template that decides first viewport for product pages;
- generic state banner automatically rendered for normal approved/current states;
- generic source-object queue copy;
- generic lifecycle action inventory that ignores gate context.

### Data And View Models

View models must be page-specific:

- `cockpitCommandCenterViewModel`;
- `requirementWorkspaceViewModel`;
- `developmentPlanWorkspaceViewModel`;
- `planItemGateWorkspaceViewModel`.

Each view model must encode:

- primary work items for first viewport;
- current gate/action;
- blocker reason;
- typed refs;
- links to downstream objects;
- evidence summary;
- empty/degraded state.

View models may share small helpers for formatting typed refs and status, but they must not collapse object semantics back into a generic `ProductPageViewModel` if that hides typed behavior.

### Tailwind-First Styling

Use Tailwind utilities and existing theme tokens by default. Add or change global CSS only for:

- design tokens;
- reset/base rules;
- MDXEditor integration where utility classes cannot reach internals;
- complex reusable component variants.

Do not introduce broad vanilla CSS page classes for one-off layout. Component files must express most layout with Tailwind utilities.

### Seeded Product Preview

The product-review preview must include enough realistic data for visual acceptance:

- at least 4 Requirements with varied priority/risk/status;
- at least 1 Initiative, 1 Bug, and 1 Tech Debt item linked into planning;
- at least 2 Development Plans;
- at least 8 Plan Items across boundary/spec/execution/review/QA states;
- at least 1 active execution;
- at least 1 interrupted/resumable execution;
- at least 1 code review with requested changes;
- at least 1 QA handoff pending or blocked;
- at least 1 release readiness blocker;
- meaningful narrative markdown and at least one attachment/evidence ref.

Preview pages must not show "summary unavailable", "planning state unknown", or "evidence unavailable" as the dominant seeded impression.

## Accessibility And Responsiveness

- All icon-only controls must have accessible names.
- All toolbar controls must be reachable by keyboard in visual order.
- Tables must support horizontal scroll at small widths and retain row focus/selection visibility.
- Mobile layouts must convert inspector rails into drawers or stacked panels, not overflow offscreen.
- Error messages must use `role="alert"` or equivalent live announcement.
- Status cannot rely on color alone; pair color with text and/or icons.
- Text must not overflow buttons, pills, cards, table cells, or side rails.
- Reduced-motion users must not rely on animated transitions to understand state.

Minimum viewport acceptance:

- 375x812 mobile;
- 768x1024 tablet;
- 1280x720 desktop;
- 1440x900 desktop.

## Implementation Plan Boundaries

The future implementation plan must be split into these phases:

1. **Preview Data And Route Stability**
   - fix product-review preview startup instability if still present;
   - expand demo seed;
   - add route screenshot contract for the four core surfaces.
2. **Layout Foundations**
   - introduce page-specific shells and neutral primitives;
   - remove generic first-viewport state banners from normal states;
   - make topbar/sidebar density stable.
3. **Cockpit Command Center**
   - rebuild cockpit view model and route layout;
   - add attention queue, flow strip, and risk rail.
4. **Requirements Workspace**
   - replace generic source-object list copy and structure;
   - build Requirement database, inspector, detail workspace, and planning actions.
5. **Development Plan Workspace**
   - upgrade index and detail table/inspector;
   - improve filters, column density, selected-item preview, and AI actions.
6. **Plan Item Gate Workspace**
   - rebuild overview and gate routes around one active gate;
   - move evidence/activity/revisions into right rail or lower secondary area;
   - make actions contextual and gate-aware;
   - include release readiness as the post-QA gate/context when a Plan Item has release impact.
7. **Verification**
   - update route-contract tests;
   - add no-generic-copy guards for the four surfaces;
   - run screenshot review across required viewports;
   - run `pnpm test`, `pnpm build`, `git diff --check`, and blocker review.

## Acceptance Criteria

- `/cockpit` first viewport shows a role-aware attention queue, delivery flow, and risk/readiness rail; it does not show generic report rows as dominant content.
- `/requirements` first viewport uses Requirement-specific language, columns, inspector, and actions; it does not contain `source object database`, `Create source object`, or `Plan source object`.
- `/requirements/:id` behaves as a document plus properties workspace with MDXEditor-backed narrative editing and visible Development Plan coverage.
- `/development-plans` shows a dense planning index with summary, filters, and plan rows that remain readable at 1280px width.
- `/development-plans/:id` shows a table-first Plan Item workspace with selected-item inspector and AI/manual planning actions.
- `/development-plans/:id/items/:itemId` overview shows one current gate as primary, compact gate rail/progress through Release readiness, and evidence/activity context; it does not render every gate body fully in first viewport.
- Spec and Execution Plan routes preserve MDXEditor document editing, attachment support, review state, and gate-aware actions.
- Actions for Spec generation, Execution Plan generation, and execution are disabled until their required upstream gates are satisfied.
- Release readiness remains visible after QA acceptance for release-impacting Plan Items, with links to Release surfaces and readiness blockers where available.
- Public UI copy does not reintroduce generic Work Item Owner or generic source-object owner semantics.
- Seeded product-review preview shows realistic density and does not rely on empty/unavailable placeholders for the main impression.
- Screenshots at 375, 768, 1280, and 1440 widths show no overlapping text, no clipped primary controls, no incoherent table overflow, and no card-in-card page sections.
- `pnpm test`, `pnpm build`, `git diff --check`, and a blocker-focused review pass before implementation is considered complete.

## Design Decisions

The following decisions are intentionally fixed for this redesign so the implementation plan does not preserve ambiguity as design debt.

### Role Lens

Role lens must become a real product filter for Cockpit and My Work in this slice. Requirements and Development Plans must inherit the selected role as a default filter where the data supports it, but they must expose local controls that let users clear or change the role filter. This avoids role silos while still making role-specific work visible.

### Requirement Detail Properties

Requirement detail must use a permanent right property rail on desktop widths. The document editor remains the main center surface; the property rail carries driver, priority, risk, status, Development Plan coverage, evidence, attachments, release refs, and audit metadata. On mobile and narrow tablet widths, the property rail collapses into a drawer or stacked properties panel.

### Plan Item Gate Actions

Plan Item gate actions live in the right decision rail on overview and gate hub routes. Document-heavy routes such as Spec and Execution Plan also get a sticky compact document toolbar for save/submit/review actions. Do not add a global sticky bottom command bar in this slice unless mobile verification proves the right rail/drawer cannot support the workflow.
