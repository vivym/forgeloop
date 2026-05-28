# Product-Grade Visual System Closure Design

## Status

User-approved design draft.

This spec defines the visual-system and page-layout closure pass for ForgeLoop Web after the AI-native project-management flow landed on `main`. It supersedes the current page-level visual direction where it conflicts with product-grade information architecture, information priority, or visual quality.

The product is not launched. Implementation must favor the correct product and frontend architecture over compatibility. Do not preserve low-quality page composition, legacy visual primitives, route compatibility surfaces, or placeholder-style layouts when they conflict with this spec.

## Context

ForgeLoop is an AI-native research and delivery operating system. The PRD defines a multi-role system where humans define goals, judge boundaries, review artifacts, supervise execution, and approve quality while Codex workers and AI agents generate artifacts and execute approved plans with traceable evidence.

The current implementation has connected the AI-native project-management loop, but the Web UI still does not feel like a mature product:

- many pages look like testing surfaces made from generic cards and sections;
- important next actions compete with low-value metadata, long explanatory copy, internal status messages, and history blocks;
- the first viewport often fails to answer who needs to act, what is blocked, and how to move forward;
- `Topbar` gives too much weight to implementation/runtime status;
- `Section`, `MetadataGrid`, table rows, and detail pages encourage field-by-field card sprawl;
- Dashboard, Development Plan, Development Plan Item, Specs and Execution Plans, Executions, Reports, Board, My Work, and Release pages do not yet share a coherent product-grade layout system;
- visual smoke tests currently catch layout breakage, but not mature information hierarchy or page quality.

The user explicitly wants all pages to be beautiful, clean, and reasonable, with no historical baggage. The target visual direction is a hybrid:

- Linear-style operational shell: compact navigation, dense queues, table-first planning, row previews, fast scanning, and understated polish;
- Notion-quality detail workspaces: document body, structured properties, linked objects, evidence, and authoring surfaces without becoming loose document pages.

Competitor references are inspirations for layout patterns only. ForgeLoop must not clone any product. The differentiator is a governed AI-native delivery loop: Requirement and other source objects produce or link Development Plans; Development Plan Items pass boundary brainstorming, Spec generation/review, Execution Plan generation/review, Codex execution, code review, QA handoff, release readiness, and reporting.

## Goals

- Make the Web UI feel like a premium, information-dense SaaS operations product instead of a debug console or a card-based test harness.
- Upgrade the shared visual system, tokens, density rules, and layout primitives so quality is enforced by reusable components rather than page-local styling.
- Redesign all main product surfaces as a coherent product:
  - Cockpit;
  - My Work;
  - Initiatives;
  - Requirements;
  - Bugs;
  - Tech Debt;
  - Development Plans;
  - Development Plan Item Detail;
  - Specs and Execution Plans;
  - Board;
  - Executions;
  - Releases;
  - Reports.
- Use action-first information hierarchy: first viewport prioritizes current state, next action, blockers, responsible role/actor, and high-risk signals.
- Move low-frequency information such as internal IDs, full audit history, complete revision history, raw evidence lists, and verbose explanatory copy out of primary visual real estate.
- Preserve the AI-native product flow:
  - source objects do not directly generate Spec or Execution Plan documents;
  - Development Plan Items remain the governed unit for boundary brainstorming, Spec, Execution Plan, execution, review, QA, and release readiness;
  - role lenses guide attention without creating role-specific duplicate object pages.
- Strengthen visual acceptance so a page cannot pass only because it has no horizontal scroll.

## Non-Goals

- No backend domain-model rewrite.
- No new real-time collaboration.
- No Evolution Loop / learning-rule authoring in this slice.
- No generic custom-field builder.
- No dark-mode switch in this slice.
- No external Jira, Linear, GitHub, Notion, or document-system sync.
- No direct Requirement/Bug/Tech Debt/Initiative to Spec or Execution Plan generation path.
- No top-level `/tasks`, legacy `/plans`, legacy `/specs`, raw replay, execution package browser, run session browser, or review packet browser product entry.
- No old/new UI switch or compatibility shell.
- No decorative marketing hero layout, oversized workbench hero typography, gradient orbs, bokeh blobs, emoji icons, or one-note palette.

## Product Principles

### Action-First First Viewport

Every primary page's first viewport must answer:

1. What object or queue am I looking at?
2. What is the most important current state?
3. Who or which role needs to act?
4. What is the next action?
5. What is blocked, risky, stale, running, or ready?

If content does not help answer those questions, it is secondary by default and must be moved to compact metadata, a drawer, a lower page section, a detail tab, or a report/evidence page.

### Shared Objects, Role-Aware Entry

The app uses a Workspace + Object Hybrid information architecture:

- `Cockpit` and `My Work` are role-aware entry surfaces.
- Requirements, Bugs, Tech Debt, Initiatives, Development Plans, Specs and Execution Plans, Executions, Releases, and Reports are canonical shared object surfaces.
- Role lenses filter and prioritize information, but must not create separate product silos where the same object has conflicting role-specific pages.

Role lenses may reorder queues, filter lists, highlight role-relevant next actions, choose default visible columns, and change explanatory helper copy.

Role lenses must not:

- change canonical route identity;
- change object truth, lifecycle state, or gate validity;
- create role-specific duplicates of the same object;
- hide blockers or failed gates from roles that need read visibility;
- make a command available when the underlying gate prerequisites are not satisfied.

### Surface-Specific Layouts

The app must not force every surface into generic cards. Page families use different layouts from one shared visual system:

- Cockpit and Reports: operational dashboard and intelligence layout.
- Source object detail: document plus properties plus linked planning relationships.
- Development Plan: table-first planning workspace with selected-row preview.
- Development Plan Item Detail: gate workspace with current action, gate progress, and compact evidence context.
- Specs and Execution Plans: grouped governance queue with row preview.
- Executions: supervision lanes for active, resumable, review-pending, failed, and completed execution states.
- My Work and Board: role-prioritized queue/board views over shared objects.
- Releases: release readiness cockpit with scope, evidence, risk, QA, rollback, and observation.

### No Card Sprawl

Cards are allowed for repeated entity items, selected previews, popovers, drawers, and bounded summaries. They are not the default way to display every field.

Disallowed patterns:

- metadata fields as large card grids;
- nested cards inside page sections;
- long explanatory state text above actual work;
- empty primary surfaces with a single centered message;
- raw runtime IDs as dominant titles;
- full revision/evidence history above current next action.

## Information Architecture

### Canonical Route Names

The canonical dashboard-like product entry is `Cockpit`, not `Dashboard`.

Route requirements:

- `/cockpit` is the canonical route for the role-aware product entry.
- `/` routes to `/cockpit` or renders the same Cockpit route module through the router's normal index mechanism.
- `/dashboard` must not remain a primary product route or navigation label.
- If `/dashboard` is retained during implementation for route-retirement coverage, it must render a product-safe retired/not-found state and must not show the old Dashboard surface.
- Tests, screenshot manifests, navigation labels, command/search entries, and user-facing copy must use Cockpit terminology.

### Global Navigation

Use the following primary navigation groups:

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
  - Specs and Execution Plans.
- Delivery:
  - Board;
  - Executions;
  - Releases.
- Intelligence:
  - Reports.
- Tools:
  - Dev Tools, development or explicit configuration only.

Do not expose raw execution package, run session, review packet, trace, replay, `/tasks`, legacy `/plans`, or legacy `/specs` entries in primary navigation.

### Route-To-Layout Matrix

The implementation plan must treat these route families as required visual surfaces:

| Route family | Layout family | Required notes |
| --- | --- | --- |
| `/` | Cockpit route/index | Must render or redirect to `/cockpit`. |
| `/cockpit` | `WorkspacePage` | Role-aware action cockpit. |
| `/dashboard` | Retired route | Product-safe retired/not-found state; no old Dashboard UI. |
| `/my-work` | `QueueWorkspace` | Actor/role attention queue with preview. |
| `/initiatives`, `/requirements`, `/bugs`, `/tech-debt` | Dense source object list | Typed list rows with next action and linked Development Plan state. |
| `/initiatives/new`, `/requirements/new`, `/bugs/new`, `/tech-debt/new` | Typed authoring workspace | MDX/editor body, compact properties, clear create action, validation state. |
| `/initiatives/:id`, `/requirements/:id`, `/bugs/:id`, `/tech-debt/:id` | `ObjectWorkspace` | Document plus properties plus linked Development Plans. |
| `/initiatives/:id/evidence`, `/requirements/:id/evidence`, `/bugs/:id/evidence`, `/tech-debt/:id/evidence` | Evidence workspace | Evidence summary first, raw artifact details secondary. |
| `/development-plans` | `PlanningTableWorkspace` index | Plan list/table, create/generate entry, filters, empty state with action. |
| `/development-plans/new` | Development Plan authoring workspace | Manual create plus AI-assisted generation inputs. |
| `/development-plans/:id` | `PlanningTableWorkspace` detail | Table plus selected-row preview. |
| `/development-plans/:id/items/:itemId` | `GateWorkspace` | Gate progress plus current action. |
| `/development-plans/:id/items/:itemId/brainstorming` | `GateWorkspace` focus view | Boundary brainstorming remains item-scoped. |
| `/development-plans/:id/items/:itemId/spec` | `GateWorkspace` focus view | Spec document surface remains item-scoped. |
| `/development-plans/:id/items/:itemId/execution-plan` | `GateWorkspace` focus view | Execution Plan document surface remains item-scoped. |
| `/development-plans/:id/items/:itemId/execution` | `GateWorkspace` focus view | Execution supervision remains item-scoped. |
| `/specs-plans` | `QueueWorkspace` | Grouped governance queue with preview. |
| `/executions` | Execution supervision lanes | Active, resumable, review-pending, failed, completed/recent. |
| `/executions/:id` | Execution detail workspace | Product supervision detail, not raw runtime browser. |
| `/board` | Flow board | Development Plan Item/gate flow, not generic task kanban. |
| `/releases`, `/releases/:id` | Release readiness workspace | Scope, evidence, blockers, rollback, observation. |
| `/releases/:id/evidence` | Release evidence workspace | Readiness evidence summary first. |
| `/reports`, `/reports/delivery`, `/reports/quality`, `/reports/release-readiness`, `/reports/observation` | Intelligence workspace | Conclusion, signal, affected objects, suggested action. |
| `/plans`, `/plans/:id`, `/specs`, `/specs/:id`, `/tasks`, `/tasks/:id`, raw replay/package/run/review browser routes | Retired or Dev Tools-only | Direct URLs must be product-safe 404/410/retired states or explicitly gated behind Dev Tools. |

The route-to-layout matrix is normative. If implementation discovers additional public product routes, the implementation plan must classify them before coding rather than leaving them visually unowned.

### Topbar

The topbar becomes a compact control surface:

- command/search input for objects, commands, and reports;
- global role lens segmented control;
- project switcher or compact project context;
- notification or activity indicator if available;
- user/actor menu.

Runtime readiness and Dev Tools visibility may appear only as compact dev/status indicators. They must not consume the same visual weight as role lens, search, or object actions.

## Page Layout Requirements

### Cockpit

The current Dashboard becomes a role-aware Cockpit at `/cockpit`. The first viewport must show:

- role-selected next-action queue;
- blockers and stale gates;
- active/resumable executions;
- Spec/Execution Plan review queue;
- QA handoff and release-readiness attention;
- compact health indicators.

Metric cards alone are insufficient. Metrics must be tied to queues or next actions. Trend/report links must not be empty side panels.

### My Work

My Work shows the current actor/role attention queue across source objects, Development Plan Items, Spec/Execution Plan reviews, executions, code review, QA, release, and blocked decisions.

Required layout:

- compact grouped queue;
- filter chips for role, status, gate, and risk;
- selected item preview with next action and disabled reason;
- bulk action support where commands are safe and explicitly scoped.

### Source Object Lists

Initiatives, Requirements, Bugs, and Tech Debt lists must become dense object lists, not sparse cards.

Each row/card must show:

- title;
- object type;
- status/gate;
- risk/priority;
- responsible role or actor where useful;
- linked Development Plan status;
- next action;
- last meaningful update.

Mobile may use compact cards, but must preserve the same priority order.

### Source Object Detail

Requirement, Bug, Tech Debt, and Initiative detail pages use an `ObjectWorkspace` layout:

- top action strip: current next action, primary command, disabled reason if blocked;
- left/main column: narrative Markdown/MDX body, acceptance criteria, problem statement, reproduction or context depending on type;
- right side panel: compact properties, role lens context, linked Development Plans, linked plan items, releases, evidence count, risk;
- lower sections or drawers: attachments, evidence, timeline, revisions.

Direct Spec or Execution Plan generation actions are disallowed on source object pages. Source objects may create, generate, link, or add rows to Development Plans.

### Development Plans

Development Plan is a first-class planning workspace, not a card list.

The `/development-plans` index is also in scope. It must not remain a sparse card list or placeholder. It must show:

- active Development Plans as a compact list/table;
- source object links and plan item counts;
- highest-risk or blocked gate summary;
- create Development Plan action;
- AI-assisted generate plan action when a source object context is selected or supplied;
- filters for source type, role, gate, risk, and status;
- empty state with manual create and AI-assisted generate options.

The `/development-plans/new` route must support manual creation and AI-assisted generation setup. It must collect enough context to create or generate a Development Plan without implying direct Spec or Execution Plan generation.

Required desktop layout:

- title and compact source summary;
- toolbar with Add row, AI draft/generate missing rows, regenerate scoped selection, view context manifest, filters, and view options;
- table-first body;
- sticky header where useful;
- selected row preview side pane.

Column model:

The Development Plan owns the full set of planning fields below, but the default table view must prioritize visible columns by viewport and role lens instead of cramming every field into one page-wide table.

Required full column set:

- Plan Item;
- responsible role;
- driver actor or role;
- reviewer;
- risk;
- dependency hints;
- affected surface;
- Boundary;
- Spec;
- Execution Plan;
- Execution;
- Review;
- QA;
- Release impact;
- Next action.

Default visible desktop columns:

- at 1440px and wider: Plan Item, role, risk, Boundary, Spec, Execution Plan, Execution, Review, QA, Release impact, Next action;
- at 1024px to 1439px: Plan Item, role, risk, current gate, gate progress summary, Execution, QA/Review summary, Next action;
- below 1024px: selected-row preview moves below the table or into a drawer; rows become compact cards below 768px.

Secondary fields such as driver actor, reviewer, dependency hints, and affected surface remain available through column configuration, row preview, compact metadata, or detail view.

No page-level horizontal scroll is allowed. Internal table-region horizontal scrolling is allowed only when:

- it is contained inside the table surface;
- the page body itself does not overflow;
- the first column and selected/next-action affordances remain visible or reachable;
- the table remains keyboard navigable;
- mobile uses compact cards rather than a squeezed wide table.

The implementation plan must define column priority and responsive behavior before coding the Development Plan table.

The selected-row preview must show:

- title and summary;
- gate progress;
- current next action;
- blockers/disabled reason;
- primary action to open the Plan Item detail;
- compact source object and evidence context.

### Development Plan Item Detail

Plan Item Detail uses a `GateWorkspace` layout.

First viewport:

- item title and compact source/development plan context;
- `GateProgress` for Boundary, Spec, Execution Plan, Execution, Code Review, QA, Release;
- `PrioritySummary` with current gate, responsible role/actor, next action, blocker, risk, and last meaningful event;
- current enabled action and disabled reason for unavailable actions;
- compact properties/evidence side panel.

Main body:

- current gate workspace appears first:
  - Boundary Brainstorming if boundary is not approved;
  - Spec document review/generation if boundary is approved and Spec is not approved;
  - Execution Plan document review/generation if Spec is approved and Execution Plan is not approved;
  - Execution supervision if Execution Plan is approved and execution is running/resumable;
  - Code Review / QA / Release readiness as those gates become active.
- generated Spec and Execution Plan documents should be visible as document surfaces, not tiny artifact rows.
- revision history, boundary summary revisions, full evidence timeline, and raw execution details are lower-priority drawers or lower sections.

### Specs And Execution Plans

Specs and Execution Plans use a governance queue, not large grouped cards.

Rows must be 44-56px on desktop and show:

- artifact type;
- source object;
- Development Plan Item;
- reviewer;
- age;
- risk;
- stale/blocked state;
- next action.

Queue groups:

- Needs generation;
- Needs review;
- Changes requested;
- Approved / ready for next gate;
- Stale or blocked.

Selecting a row opens a preview with document summary, gate status, reviewer, related plan item, and primary command.

### Executions

Executions use supervision lanes:

- Active;
- Resumable;
- Review pending;
- Failed/blocked;
- Completed/recent.

Each row/card shows:

- approved Execution Plan revision;
- Development Plan Item;
- worker state;
- current step;
- last event time;
- PR/diff/test evidence summary;
- interrupt/continue/inspect action where allowed.

Raw runtime object IDs are secondary metadata only.

### Execution Detail

Execution detail uses a product supervision layout, not a runtime browser.

First viewport must show:

- execution title derived from the Development Plan Item and approved Execution Plan revision, not raw run/package IDs;
- worker state;
- current step;
- last meaningful event;
- interrupt/continue/retry/inspect actions where allowed;
- disabled reasons for unavailable actions;
- PR/diff/test evidence summary;
- linked Development Plan Item and approved Execution Plan revision.

Lower-priority sections may show:

- event timeline;
- runtime evidence references;
- logs/check output summaries;
- review and QA handoff context;
- raw IDs only as compact metadata.

### Board

Board is a delivery flow view over Development Plan Items and active gates, not a generic kanban of tasks.

Suggested columns:

- Intake / Development Plan needed;
- Boundary;
- Spec;
- Execution Plan;
- Execution;
- Review;
- QA;
- Release.

Cards must show type, title, role/actor, blocker, risk, and next action.

### Releases

Releases use a release readiness cockpit layout:

- scope summary;
- readiness by Spec, Execution Plan, execution, code review, QA, release blockers, evidence, rollback plan, observation;
- high-risk changes;
- required approvals;
- launch/rollback actions with disabled reasons;
- evidence and replay links as secondary surfaces.

Release Owner wording remains valid on release pages only.

### Reports

Reports become operational intelligence surfaces:

- Delivery bottlenecks;
- Quality and QA readiness;
- Release readiness;
- Observation;
- scoped replay/evidence context.

Reports should not be empty link panels. Each report section must show a conclusion, supporting signal, affected objects, and suggested action.

### Authoring And Evidence Surfaces

Create, edit, and evidence routes are first-class visual surfaces in this closure. They must use the same product-grade system as list/detail pages.

Authoring requirements:

- typed source object create routes use an authoring workspace, not a plain form stack;
- MDXEditor remains behind the shared ForgeLoop Markdown editor wrapper;
- narrative fields receive enough width for serious reading and writing;
- structured fields remain structured and do not move into Markdown;
- validation messages appear near fields and in a compact summary;
- attachment and image insertion use the existing attachment/evidence model;
- unsaved-change and destructive navigation states are visible.

Evidence requirements:

- evidence pages lead with evidence readiness and relevance, not raw artifact lists;
- raw package/run/review links remain secondary and scoped;
- missing, stale, unauthorized, or tombstoned evidence appears as product-safe unavailable evidence blocks.

## Design System Requirements

### Tokens

Keep a neutral light product theme, but tune tokens for maturity and density:

- background: off-white or very light slate;
- surface: white;
- surface-subtle for selected/preview backgrounds;
- clear border and hover tokens;
- primary blue used sparingly for focus, selected, and primary actions;
- status hues for success, warning, danger, info, and neutral;
- radius generally 6-8px;
- no pill-shaped generic cards except badges/status pills;
- no heavy shadows except overlays, drawers, menus, and active raised surfaces;
- typography optimized for dense operational UI:
  - page title: 22-24px;
  - section title: 14-16px;
  - table/body: 13-14px;
  - caption/meta: 12px;
  - no viewport-scaled font size;
  - no negative letter spacing.

Plus Jakarta Sans or Inter/system fallback is acceptable. The implementation must avoid introducing a blocking external-font dependency if it hurts local development reliability.

### Shared Primitives

The implementation must add or upgrade the following primitives:

- `WorkspacePage`;
- `ObjectWorkspace`;
- `QueueWorkspace`;
- `PlanningTableWorkspace`;
- `GateWorkspace`;
- `ActionStrip`;
- `PrioritySummary`;
- `CompactMetadata`;
- `GateProgress`;
- `PreviewPane`;
- `EvidenceDrawer`;
- `RevisionDrawer`;
- `StatusPill` / `Badge`;
- `DataTable` / queue table;
- `EmptyState`, `Skeleton`, `InlineNotice`, `ErrorState` with layout-preserving variants.

Primitives must be business-agnostic where practical. Feature-specific content belongs in feature modules, but repeated layout behavior belongs in `shared/layout` or `shared/ui`.

### Information Weight Rules

Components must encode information priority:

- next action and blocker outrank metadata;
- current gate and gate progress outrank full history;
- selected object title and status outrank source IDs;
- role/actor responsibility outranks timestamps unless aging is the problem;
- evidence summary outranks full evidence list;
- disabled reason outranks disabled button chrome.

`MetadataGrid` must not encourage large card-like field blocks in primary surfaces. Replace it with compact property lists for side panels and dense object headers.

### Interaction

- Buttons and links must use semantic elements.
- All clickable rows and preview items must expose hover, selected, and focus states.
- Hover states must not shift layout.
- Keyboard navigation must work for table row selection, tabs, drawers, dialogs, and action strips.
- Destructive or high-risk actions require confirmation and clear disabled reasons.
- Loading, empty, stale, blocked, running, resumable, approved, and error states must be visible with text and not color alone.

## Data Flow And Presentation View Models

This slice is Web-first. Do not rewrite backend data ownership. Continue to use the existing Web API clients and TanStack Query hooks.

Add feature-level presentation view-model adapters where needed. These adapters transform API projections into UI-priority shapes:

- `objectLabel`;
- `objectType`;
- `statusLabel`;
- `currentGate`;
- `nextAction`;
- `blockedReason`;
- `primaryActorOrRole`;
- `riskSignal`;
- `gateProgress`;
- `criticalEvidence`;
- `secondaryMetadata`;
- `previewSummary`;
- `timelineSummary`.

Page components should render these view models rather than directly spreading raw API fields into visual sections.

Adapters must not hide unavailable data. If data is missing, the UI should render a truthful degraded state and a recovery path where one exists.

Backend/API/query changes are allowed only when a product-grade page cannot truthfully render required state from existing projections. Any such change must be:

- explicitly identified in the implementation plan before coding;
- limited to the smallest necessary projection/read-model field;
- covered by contract or API tests;
- reflected in Web fixture data;
- rejected if it changes domain lifecycle semantics rather than presentation data.

Expected backend-capable file areas, only if justified by the implementation plan:

- `packages/contracts/**`;
- `packages/db/src/queries/**`;
- `apps/control-plane-api/src/modules/**`;
- `tests/contracts/**`;
- `tests/api/**`.

## State Handling

### Loading

Loading states must use skeletons that preserve the final layout. Avoid large blank surfaces.

### Empty

Empty states must include:

- what is missing;
- why it matters;
- the next available action;
- secondary action where useful.

An empty primary surface with only centered text is not acceptable.

### Error

Error states must identify the failing surface and provide a recovery action where possible. Error banners should not consume the whole first viewport unless the page cannot render safely.

### Stale, Blocked, Running, Resumable, Approved

These states must include visible text, reason, and next action. Color-only status is prohibited.

### Disabled Actions

Disabled gate actions must explain why the action is unavailable, for example:

- boundary not approved;
- Spec not approved;
- Execution Plan not approved;
- execution already running;
- review not complete;
- QA handoff missing;
- release blockers unresolved.

## Accessibility And Responsiveness

- Required breakpoints: 375, 768, 1024, and 1440px.
- No horizontal scroll on any main route.
- Mobile layouts may collapse side panels into drawers or stacked sections, but must preserve action-first priority.
- Tables may become compact cards on mobile, but each card must preserve title, state, next action, risk, and current gate.
- Role lens labels must remain visible or be available through an accessible control.
- All controls must have accessible names.
- Dynamic command completion and state changes must be announced through existing toast/live-region patterns or an equivalent accessible mechanism.

## Visual Acceptance

Implementation review fails if screenshots show:

- incoherent overlap;
- horizontal page scroll;
- hidden or clipped action labels;
- card-in-card page composition;
- metadata card sprawl;
- large empty primary surfaces without a next action;
- hidden role lens labels;
- action rail or preview pane covering primary content;
- status communicated by color alone;
- raw runtime object as dominant page title;
- internal/dev status using more visual weight than product state;
- first viewport that does not show current state, next action, responsible role/actor, and blocker/risk where relevant.

### First-Viewport Test Contract

Every route family in the route-to-layout matrix must expose stable test hooks or accessible landmarks so automated checks can assert the first viewport without brittle copy matching.

Required contract per rendered product page:

- one visible `h1` or equivalent page heading;
- one current-state affordance with accessible text;
- one next-action region, even when the next action is disabled or unavailable;
- one owner/role/responsibility affordance where the object has an actionable owner or role;
- one blocker/risk affordance when blocked, stale, failed, high-risk, or degraded;
- a route-family marker such as `data-page-family`, `data-workspace-layout`, or equivalent accessible landmark.

The implementation plan must define the exact test hook names or accessible landmarks before implementing broad screenshot checks.

## Verification Requirements

### Screenshot Manifest

Capture and review screenshots for:

- `/`;
- `/cockpit`;
- `/dashboard`;
- `/my-work`;
- `/requirements`;
- `/requirements/new`;
- `/requirements/:id`;
- `/requirements/:id/evidence`;
- `/initiatives`;
- `/initiatives/new`;
- `/initiatives/:id`;
- `/initiatives/:id/evidence`;
- `/bugs`;
- `/bugs/new`;
- `/bugs/:id`;
- `/bugs/:id/evidence`;
- `/tech-debt`;
- `/tech-debt/new`;
- `/tech-debt/:id`;
- `/tech-debt/:id/evidence`;
- `/development-plans`;
- `/development-plans/new`;
- `/development-plans/:id`;
- `/development-plans/:id/items/:itemId`;
- `/development-plans/:id/items/:itemId/brainstorming`;
- `/development-plans/:id/items/:itemId/spec`;
- `/development-plans/:id/items/:itemId/execution-plan`;
- `/development-plans/:id/items/:itemId/execution`;
- `/specs-plans`;
- `/executions`;
- `/executions/:id`;
- `/board`;
- `/releases`;
- `/releases/:id`;
- `/releases/:id/evidence`;
- `/reports`;
- `/reports/delivery`;
- `/reports/quality`;
- `/reports/release-readiness`;
- `/reports/observation`.

Each required route needs 1440, 1024, 768, and 375px screenshots. Dynamic routes must have deterministic fixture IDs or seeded fixture data; implementation may not skip a required route family only because a fixture does not already exist.

Retired-route screenshots or route smoke assertions are required for:

- `/plans`;
- `/plans/:id`;
- `/specs`;
- `/specs/:id`;
- `/tasks`;
- `/tasks/:id`;
- raw replay routes if still registered;
- raw execution package, run session, and review packet browser routes if still registered.

Retired routes must not appear in primary navigation, command/search suggestions, product links, or happy-path route fixtures.

Dynamic route fixture IDs must be defined in the implementation plan before coding. The fixture manifest must include at least one populated example for each dynamic route family:

- one source object per type where available;
- one Development Plan;
- one Development Plan Item;
- one active execution;
- one release.

### Automated Gates

Keep and expand:

- route smoke tests;
- no horizontal scroll checks;
- no-baggage route/nav scans;
- accessibility tests;
- responsive layout tests;
- route screenshot generation.

Add mandatory checks:

- screenshot manifest validation that asserts every required route/viewport was captured;
- rendered first-viewport checks for visible heading, current state, next action/action strip, and non-color-only status;
- direct URL checks for retired legacy routes and raw runtime browser routes;
- command/search fixture checks proving retired routes are not suggested;
- unit tests for presentation view-model adapters.

Add best-effort checks where practical:

- visual anti-pattern scans, including card-in-card markers, metadata-card-sprawl markers, and raw runtime dominant title markers;
- bounding-box overlap checks for action strips, preview panes, and sticky table regions.

### Manual Review Checklist

The implementation PR must include a short visual review note answering:

- Which screenshots were reviewed?
- Does each first viewport show current state, next action, owner/role, and blocker/risk?
- Which low-priority information was moved out of primary visual space?
- Are there any intentionally degraded pages?
- Are there any remaining visual debt items? If yes, why are they not blockers?

## Implementation Boundaries

Expected code areas:

- `apps/web/src/shared/styles/theme.css`;
- `apps/web/src/shared/layout/**`;
- `apps/web/src/shared/ui/**`;
- `apps/web/src/app/routes/_layout.tsx`;
- `apps/web/src/app/routes/**`;
- `apps/web/src/features/**`;
- `tests/web/**`;
- `tests/e2e/**`;
- `apps/web/src/shared/design-system/docs/component-guidelines.md`.

Backend-capable code areas are allowed only under the projection exception defined in "Data Flow And Presentation View Models".

Avoid changing:

- backend persistence semantics;
- domain object lifecycle;
- API contracts except where presentation-specific query fields already exist or a small projection field is required and justified;
- unrelated executor/runtime safety work;
- externally owned parallel worktrees.

## Required Implementation Phases

The implementation plan must decompose this work into phases. A single unstructured "rewrite UI" task is not acceptable.

Required phases:

1. Visual-system foundation:
   - tokens;
   - shared layout primitives;
   - shared UI primitives;
   - component guidelines;
   - anti-pattern markers and tests.
2. Shell and IA:
   - `/cockpit` route;
   - `/` index behavior;
   - `/dashboard` retirement;
   - navigation;
   - topbar;
   - role lens contract.
3. Presentation view models and fixtures:
   - page-family view-model adapters;
   - fixture manifest;
   - first-viewport test contract.
4. Source object list/detail/authoring/evidence surfaces:
   - Initiatives;
   - Requirements;
   - Bugs;
   - Tech Debt.
5. Planning surfaces:
   - Development Plans index;
   - Development Plan creation/generation;
   - Development Plan detail table and preview;
   - Development Plan Item gate workspace and focus routes.
6. Delivery and governance surfaces:
   - Specs and Execution Plans queue;
   - Executions list and detail;
   - Board;
   - Releases and release evidence.
7. Intelligence surfaces:
   - Reports index and report routes.
8. Final visual closure:
   - screenshot manifest;
   - responsive/a11y/no-baggage gates;
   - manual visual review note;
   - final fixes from screenshots.

Each phase must have a verification checkpoint. Final screenshot closure cannot be the only verification point.

## Risks And Mitigations

- Risk: the redesign becomes too broad for one implementation pass.
  - Mitigation: within the required phases above, the implementation plan may split tasks by page family, but all tasks must share this visual system and final screenshot closure.
- Risk: page authors reintroduce card sprawl with Tailwind utility classes.
  - Mitigation: add component guidelines and anti-pattern tests/markers; require shared primitives for page shells.
- Risk: action-first UI hides necessary audit context.
  - Mitigation: use drawers, lower sections, and evidence/timeline routes; do not delete auditability.
- Risk: visual tests pass while the page still looks poor.
  - Mitigation: add screenshot manifest plus manual review checklist as PR evidence.
- Risk: competitor inspiration leads to imitation.
  - Mitigation: references are pattern-level only; ForgeLoop's AI-native gate model remains the product shape.

## References

- PRD: `docs/PRD_v1.md`
- Prior Web architecture spec: `docs/superpowers/specs/2026-05-18-web-product-ui-architecture-redesign-design.md`
- AI-native project management UX spec: `docs/superpowers/specs/2026-05-23-ai-native-project-management-ux-redesign-design.md`
- Project management IA and authoring spec: `docs/superpowers/specs/2026-05-23-project-management-ia-authoring-design.md`
- Current design-system guidance: `apps/web/src/shared/design-system/docs/component-guidelines.md`
- Linear product patterns: compact planning lists, boards, display options, and project/initiative planning.
- GitHub Projects patterns: table, board, roadmap-style project views and insights.
- Notion Projects patterns: database properties, document workspace, and multiple views.
- Jira Product Discovery patterns: idea discovery, prioritization, roadmaps, and delivery links.
