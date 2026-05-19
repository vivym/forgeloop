# Web Product UI Architecture Redesign Design

## Status

User-approved design draft. This document defines the target Web product architecture and visual system before implementation planning.

The redesign is intentionally not a skin over the current Web workbench. The final implementation must replace the existing monolithic UI with a product-grade frontend architecture and must not keep a legacy route, legacy workbench fallback, or parallel old/new CSS system.

## Context

ForgeLoop now has a delivery/product backend model with Work Items, Spec/Plan, Execution Packages, Run Sessions, Review Packets, Evidence Chain, Release Cockpit, Role Workbench projections, and durable replay/evidence paths.

The current Web app exposes many of those capabilities, but it presents them as a dense single-page internal workbench:

- `apps/web/src/App.tsx` owns most page state, forms, role queue rendering, Work Item cockpit, Spec/Plan commands, package commands, Run Console, Review Packet decisions, Release cockpit, release commands, replay snippets, and debug-style manual ID entry.
- `apps/web/src/styles.css` defines a broad `.panel` / `.workbench-grid` / form-grid visual system that reads like an internal control panel.
- Most modules are shown at once, which makes the app hard to scan and weakens the PRD product story.
- Product actions and debug/manual operations are mixed together.
- The UI has no page-level URL model for the main objects. A user cannot reliably deep link into Work Item, Run, Review, or Release contexts as first-class pages.

The product now needs a true frontend architecture: role-based entry, object detail pages, a clean design system, responsive layout, strong visual hierarchy, and a deliberate place for raw/debug tools.

## Goals

- Replace the current Web UI with a product-grade app shell, routes, layout system, and design system.
- Make the default product entry a Work Item Owner-oriented role workbench.
- Preserve all current main-flow capabilities under new productized pages:
  - Role Workbench
  - Pipeline
  - Work Item detail
  - Spec & Plan
  - Execution Package
  - Run Console
  - Review Packet
  - Release Cockpit
  - Dev Tools for raw/debug operations only
- Make all primary delivery objects deep-linkable.
- Separate product actions from debug/raw tools.
- Introduce a complete design system layer rather than ad hoc page-local styling.
- Use a product-grade frontend stack that supports routing, server state, forms, tables, component primitives, and visual tests.
- Keep the UI clean, calm, professional, and information-dense.
- Remove the historical monolithic workbench shape by the end of implementation.

## Non-Goals

- No backend object model redesign in this slice.
- No Evolution Loop / retrospective-learning implementation.
- No Next.js or Remix server-side migration in this slice.
- No dark-mode UI switch in the first version.
- No legacy route such as `/legacy`.
- No old workbench fallback.
- No long-lived dual styling system.
- No attempt to productize every raw/debug endpoint. Debug affordances belong in Dev Tools, not primary product pages.

## Hard Requirements

- The final Web app must have one product entry, not old and new UIs side by side.
- The old single-file workbench structure must be removed. `App.tsx` may only survive as a trivial framework compatibility export during migration if React Router requires it; it must not own workbench state, command forms, debug controls, or page composition.
- The old `.panel` / `.workbench-grid` debug panel visual system must not remain as an active or dead page styling system. New surfaces use named layout primitives from `shared/layout` and `shared/ui`.
- Main product pages must not expose raw JSON blobs, manual ID loaders, direct patch helpers, or direct link/unlink helpers unless the raw data is itself a product evidence/log artifact.
- Dev Tools must be hidden outside development or explicit configuration.
- Force rerun, override approval, release close, observation evidence, and similar high-risk commands remain product governance actions on the relevant object pages. They must not be hidden in Dev Tools simply because they are advanced.
- No emoji icons. Use a consistent icon set.
- No card-in-card page composition. Use page sections, panels, tables, drawers, dialogs, and action rails.
- All major pages must fit desktop and mobile without horizontal scroll.
- No historical compatibility route, compatibility stylesheet, compatibility selector alias, or old/new branch switch may remain in the final branch.
- Existing pure helpers may be relocated only when they are small, named, tested, and business-generic. Old mixed UI state containers, broad workbench components, and page-specific CSS must be deleted rather than wrapped.

## Technology Decision

Use:

- React Router Framework Mode
- Vite
- Tailwind CSS
- shadcn/ui plus Radix primitives
- lucide-react
- TanStack Query
- React Hook Form plus Zod
- TanStack Table
- Vitest
- Playwright visual/smoke checks

### Why React Router Framework Mode

ForgeLoop is a highly interactive internal SaaS workbench. It needs route modules, nested layouts, deep links, route error/loading boundaries, code splitting, and URL state. React Router Framework Mode provides those product app boundaries while preserving the current Vite/React foundation.

React Router's framework mode supports Vite integration, type generation, code splitting, and optional rendering strategies without forcing a server-component architecture.

### Why Not Next.js

Next.js App Router is strong for public SaaS sites, content-heavy apps, SSR-heavy surfaces, and React Server Component use cases. ForgeLoop's current Web surface is mostly authenticated, stateful, client-interactive operations:

- Run Console SSE
- command forms
- role queue filters
- object detail tabs
- release cockpit commands
- local actor/project context

Most pages would become client components, while Next's server/cache/RSC boundary would add complexity. The extra migration cost is not justified for this scope.

### Why Not Keep Plain Vite SPA Tabs

Continuing as a plain single-page tabbed app would retain the main historical frontend problem: weak page boundaries, weak deep links, and broad app-root state. The redesign must introduce true page architecture.

### UI System Decision

Use shadcn/ui and Radix primitives because they provide accessible component structure while keeping component code owned by the project. This avoids a heavy third-party component library look and supports a ForgeLoop-specific product language.

Use lucide-react for icons. Do not use emojis as UI icons.

Use TanStack Query for server state so pages stop manually coordinating global reloads and broad app-level state updates. Use feature-specific query keys and targeted invalidation.

Use React Hook Form plus Zod for complex command and revision forms. Keep Zod schemas close to payload parsing where useful.

Use TanStack Table for structured data tables instead of div grids for table-like layouts.

## Information Architecture

### Top-Level Navigation

The app uses a hybrid model: a role-based home plus object detail routes.

Primary navigation:

- `Workbench`
- `Pipeline`
- `Work Items`
- `Specs & Plans`
- `Packages`
- `Runs`
- `Reviews`
- `Releases`
- `Dev Tools` when enabled

The default route is `Workbench`, oriented around the Work Item Owner. The user can switch role queues from there:

- Work Item Owner
- Spec Approver
- Execution Owner
- Reviewer
- QA / Test Owner
- Release Owner
- Manager

Role labels are product language. Backend/query ids are adapter details and must not leak into navigation labels:

| Product label | Query/workbench id |
| --- | --- |
| Work Item Owner | `intake` |
| Spec Approver | `spec-approver` |
| Execution Owner | `execution-owner` |
| Reviewer | `reviewer` |
| QA / Test Owner | `qa-test-owner` |
| Release Owner | `release-owner` |
| Manager | `manager-health` |

`Intake` may appear only in adapter code, API fixtures, or developer-facing tests. Product UI copy uses `Work Item Owner`.

Object detail pages are first-class routes:

- `/workbench`
- `/pipeline`
- `/work-items`
- `/work-items/new`
- `/work-items/:workItemId`
- `/work-items/:workItemId/spec-plan`
- `/specs`
- `/specs/:specId`
- `/specs/:specId/revisions/:revisionId`
- `/plans`
- `/plans/:planId`
- `/plans/:planId/revisions/:revisionId`
- `/packages`
- `/packages/:packageId`
- `/runs`
- `/runs/:runSessionId`
- `/reviews`
- `/reviews/:reviewPacketId`
- `/releases`
- `/releases/:releaseId`
- `/dev-tools` only when enabled

### Product Layout

The main shell has:

- Left sidebar for product navigation, project context, and role context.
- Topbar for global search, project filter, actor context, environment/durability state, and lightweight notifications.
- Main content region for the selected page.
- Right-side Action Rail on object detail pages.
- Drawers/dialogs for create/edit/decision flows.

The app should feel like a focused operations product:

- The home page answers "what needs my attention now?"
- Object pages answer "what is the state of this item and what can I do next?"
- Pipeline answers "where is the system blocked?"
- Run Console answers "what is this AI execution doing right now?"
- Release pages answer "can this ship safely?"

## Page Designs

### `/workbench`

The Workbench is the default landing page and role queue.

Structure:

- Page header with role, project, actor, queue count, and active filters.
- Role switcher for the seven PRD roles.
- Filter bar for project, actor, kind, phase, status, risk.
- Two-column body:
  - left: queue table/list with priority, object type, state, risk, SLA/staleness indicators;
  - right: selected item preview with summary, blockers, next actions, and links to the full object page.

`Work Item Owner` is a role, not a Work Item type. Queue rows must still expose product object type and Work Item kind/surface where available, such as feature, defect, tech debt, infra, QA/integration, release/flag, incident follow-up, or documentation. The UI must not collapse those object distinctions into one coarse owner bucket.

The Workbench must not expand all editing forms inline. It routes users into object pages or opens narrow drawers for simple create flows.

### `/pipeline`

Pipeline is the delivery flow overview.

Stages:

- Intake
- Spec / Plan
- Execution
- Review
- Integration / Cross-end Validation
- Test / Acceptance
- Release
- Observation

Each stage shows:

- item count
- blocked count
- high-risk count
- stale/SLA hints
- representative cards or table rows

Integration / Cross-end Validation must show readiness status, dependency blockers, cross-surface contract/mock readiness, environment requirements, and linked packages that are waiting on another surface.

Test / Acceptance must show QA/test owner queues, test strategy gaps, acceptance criteria state, high-risk quality gates, regression coverage gaps, and release-blocking acceptance issues.

Pipeline is primarily for Manager, Release Owner, and cross-role coordination. It does not replace object detail pages.

Pipeline needs an explicit read model. It must not fake a global board by scraping only the currently selected Work Item. The implementation has two acceptable paths:

- preferred: add a first-class `/query/pipeline` API that returns stage counts, representative objects, blocker summaries, high-risk counts, stale/SLA hints, integration readiness fields, test/acceptance gate fields, and per-stage degraded-data markers;
- temporary within the same final PR only: compose the initial Pipeline from existing role workbench projections, clearly document the degraded data coverage in code, and still expose a route-level empty/degraded state.

If the preferred API is not implemented in this UI slice, the plan must include a concrete limitation and the Pipeline page must not claim global completeness.

### `/work-items`

Work Items list page.

Capabilities:

- filters via URL search params;
- table view for title, kind, risk, phase, gate, owner, updated age;
- create Work Item action;
- row click to `/work-items/:workItemId`;
- empty state with product copy and primary create action.

### Work Item Intake And Brief

The PRD intake flow is part of the main product loop and must not disappear behind generic Work Item creation.

`/work-items/new`:

- captures project, kind, title, goal, success criteria, priority, risk, owner, and optional raw request/context;
- shows structured normalization feedback before creation when supported;
- routes to the created Work Item detail and its Intake/Brief area.

Workbench and Work Item detail:

- Work Item Owner queue highlights items needing triage, brief confirmation, classification, or pre-Spec readiness;
- Work Item detail Overview includes a Brief / Intake section with normalized problem statement, user value, constraints, acceptance intent, risk/priority rationale, owner, and missing-info blockers;
- users can confirm the brief before Spec creation when the backend supports that state;
- Spec creation is blocked or clearly warned when required brief fields/readiness are missing.

Current API gap: the Web client currently exposes basic `createWorkItem`, `listWorkItems`, and `getWorkItem` commands, but not Work Item Brief generation, normalization, triage classification, or confirm-before-Spec endpoints. The implementation plan must either add those read/command endpoints and query hooks in this slice, or explicitly mark the first UI as a degraded intake surface that captures the structured fields manually and shows that automated brief generation/confirmation is unavailable. It must not silently imply that AI-generated brief/triage is complete when no backend capability exists.

### `/work-items/:workItemId`

Work Item detail page.

Header:

- title
- kind
- priority
- risk
- phase
- gate state
- owner
- primary next action

Tabs:

- Overview
- Spec & Plan
- Packages
- Validation
- Timeline
- Evidence

Action Rail:

- blockers
- next actions
- key dates/status
- primary commands

The Validation tab surfaces cross-end readiness, package dependencies, test strategy, QA owner, acceptance criteria, blocked integrations, and links to related release/test evidence. It is the Work Item-level home for the PRD Integration / Cross-end Validation and Test / Acceptance stages.

The detail page is the main "finish this item" surface. It must not look like a debug dump.

### `/work-items/:workItemId/spec-plan`

Spec & Plan strong page.

Structure:

- split view for current Spec and current Plan status;
- revision list with current revision clearly marked;
- structured document view in the center;
- Action Rail for create Spec, create Plan, generate draft, submit, approve, request changes, and create revision.

Revision forms use drawer/dialog flows. Large textareas do not live permanently on the first screen.

The page must preserve the current new-item path where a Work Item has no Spec or Plan yet:

- if no Spec exists, show a primary "Create Spec" action;
- if a Spec exists but no Plan exists, show a primary "Create Plan" action;
- draft generation remains unavailable until the corresponding object exists;
- revision creation remains unavailable until the corresponding object exists.

### `/specs/:specId`, `/plans/:planId`, and Revision Routes

Spec and Plan are primary delivery objects and need direct URLs in addition to the Work Item-scoped Spec & Plan page.

`/specs` and `/plans` are registry/list pages for discovery and cross-role review:

- filters for project, status, approver, current revision state, and updated age;
- table rows link to the direct detail routes;
- empty/degraded states are explicit if the API can only list through Work Item context initially;
- create actions route users back to Work Item context when a new Spec or Plan requires a parent Work Item.

These routes are detail shortcuts:

- `/specs/:specId` loads the Spec status, current revision, parent Work Item link, allowed Spec commands, and a History / Timeline section;
- `/plans/:planId` loads the Plan status, current revision, parent Work Item link, allowed Plan commands, and a History / Timeline section;
- `/specs/:specId/revisions/:revisionId` and `/plans/:planId/revisions/:revisionId` show a read-only revision detail with structured document content, parent links, and revision history metadata.

Spec/Plan History / Timeline must show revision creation/submission/approval/request-changes events, current revision changes, actor and timestamp, parent Work Item linkage, and downstream package generation when applicable.

Current API gap: the query API exposes Work Item, Execution Package, Review Packet, and Release replay, but not Spec/Plan replay. The implementation plan must choose one explicit backing path:

- preferred: add `getSpecReplay` and `getPlanReplay` query endpoints;
- acceptable first slice: derive Spec/Plan history from parent Work Item replay and revision lists, with an explicit degraded state when the parent Work Item cannot be resolved.

If the current API cannot directly resolve a Spec or Plan by id in a way the route needs, the implementation plan must add or expose the missing read endpoint. Do not implement these routes as broken shells.

### `/packages`

Execution Packages list page.

Capabilities:

- filters for project, Work Item, PlanRevision, owner, reviewer, QA owner, surface type, lifecycle state, risk, and blocked status;
- table view for package objective, Work Item, surface type, state, last run, reviewer/QA, and updated age;
- actions to generate packages from an approved PlanRevision when launched with Plan context;
- action to create a manual Execution Package when a PlanRevision is selected;
- row click to `/packages/:packageId`.

If the backend cannot list Execution Packages globally yet, the final implementation must either add a read model or show a truthful scoped/degraded list state. It must not fake a complete package inventory by scraping the currently selected Work Item.

### `/packages/:packageId`

Execution Package detail page.

Tabs:

- Overview
- Runs
- Review
- Artifacts
- Timeline / Replay
- Policy

Content:

- objective
- repo
- owner/reviewer/QA
- lifecycle state
- path policy
- required checks
- required artifact kinds
- blocked reason
- last failure summary
- replay timeline from `getExecutionPackageReplay`, shown as product history rather than raw JSON

Actions:

- generate packages from the approved PlanRevision;
- create manual package;
- mark ready
- run
- rerun
- force rerun
- edit package details

Force rerun is advanced but productized; it belongs here with clear reason capture and risk wording.

Package creation and generation are part of the main flow, not Dev Tools. They can be launched from the Work Item Packages tab, the Spec & Plan page after Plan approval, or a package list page, but the new UI must preserve both:

- generate Execution Packages from a PlanRevision;
- create a manual Execution Package with repo, objective, owners, required checks, artifact kinds, allowed paths, and forbidden paths.

### `/runs` and `/runs/:runSessionId`

Runs list shows active and recent Run Sessions.

Runs list also needs an explicit data source. The current Web API client can load individual Run Sessions and events, but it does not expose a global run list. The implementation has two acceptable paths:

- preferred: add a `/query/runs` or equivalent read model for active/recent Run Sessions with project, package, status, executor, updated age, and review link data;
- temporary within the same final PR only: provide `/runs` as a search/deep-link page driven by URL params and role-workbench links, while clearly showing that it is not a global run inventory.

The `/runs/:runSessionId` detail page is required regardless; it can use the existing individual run/session event APIs.

Run detail is the Execution Command Center:

- Run Console is the center of the page.
- Left metadata rail shows package, executor, status, worker lease, danger mode, thread/turn ids, last event, and current plan step.
- Center stream shows visible run events and terminal/agent messages.
- Right panel shows artifacts, checks, failure summary, and related Review Packet.
- Input, cancel, and resume controls are stable and responsive.

Raw debug metadata is hidden unless Dev Tools are enabled. Product evidence and logs can still be displayed when they are part of the Run product surface.

### `/reviews/:reviewPacketId`

Review Packet list and detail pages.

`/reviews` is the Reviewer queue and review history page:

- filters for project, reviewer, decision state, risk, changed files, related package, and stale/SLA status;
- table rows show package, summary, decision state, risk, check summary, and updated age;
- row click to `/reviews/:reviewPacketId`;
- empty/degraded state is explicit if the API can only discover Review Packets through Role Workbench links initially.

`/reviews/:reviewPacketId` is the judgment detail page.

Content:

- summary
- decision/status
- changed files
- check result summary
- self-review
- risk notes
- requested changes
- related run/package links
- timeline/replay tab or section from `getReviewPacketReplay`

Actions:

- approve
- request changes

The page must optimize for judgment. It should show decision material, not internal object clutter.

### `/releases` and `/releases/:releaseId`

Releases list shows candidate and active releases using the existing `listReleases` API.

`/releases` list contract:

- filters for project, release owner, phase, gate state, resolution, release type where available, and updated age;
- table rows show title/key, phase, gate state, resolution, release owner, linked Work Item count, linked Execution Package count, rollout/rollback/observation completeness, blocker/acceptance summary where available, and updated age;
- row click routes to `/releases/:releaseId`;
- primary create-release action opens a drawer/dialog, not an always-visible form;
- empty state explains that no releases match the current filters and provides the create-release action;
- loading and error states use the shared page section/table states;
- pagination uses `next_cursor` from `ReleaseListResponse`;
- the page must not include manual `release_id` loaders, raw replay controls, raw JSON, or direct low-level link/unlink text fields. Those remain Dev Tools-only.

Release creation and edit are productized flows:

- `/releases` provides a create-release action;
- `/releases/:releaseId` provides edit release details through a drawer/dialog;
- create/edit fields include actor, project, title, scope summary, rollout strategy, rollback plan, and observation plan.

Release detail is the Release Cockpit:

- header with title, phase, gate state, resolution, release owner, blocker fingerprint;
- scope summary;
- linked Work Items;
- linked Execution Packages;
- productized scope management for adding/removing Work Items and Execution Packages through pickers or scoped action dialogs;
- blockers grouped by category;
- checklist;
- Test Acceptance / Acceptance Evidence section;
- risk summary;
- evidence and observations;
- decisions;
- replay timeline.

Actions:

- create release from the release list;
- edit release details;
- add/remove Work Items from scope;
- add/remove Execution Packages from scope;
- submit
- approve
- acknowledge test acceptance
- override approve
- request changes
- start observing
- close release
- submit observation evidence

Release approval must make the PRD Test / Acceptance gate visible before release. `acknowledgeReleaseTestAcceptance` is a product action, not a Dev Tools action. It requires actor, acceptance summary, linked evidence where supported, and a visible state transition/checklist update. If the implementation needs separate risk notes beyond the current API contract, the plan must either extend the API explicitly or represent the risk context through supported summary/evidence fields.

Override approval and close release must use clear confirmation and rationale capture.

### `/dev-tools`

Dev Tools are available only in development or explicit feature configuration.

They contain:

- manual object ID loaders;
- raw replay reads;
- direct link/unlink helpers;
- direct patch/debug helpers;
- API smoke utilities;
- raw payload inspection when necessary.

Dev Tools are not a fallback for the old app.

Dev Tools gating is explicit:

- flag source: `import.meta.env.DEV` or a typed environment flag such as `VITE_FORGELOOP_ENABLE_DEV_TOOLS=true`;
- route guard: `/dev-tools` returns a product 404 or "not enabled" route state when disabled, and the sidebar item is absent;
- production behavior: production builds default to hidden unless the explicit flag is present at build/runtime configuration;
- negative tests: every primary product route is tested with Dev Tools disabled to ensure raw controls, manual ID loaders, direct patch forms, raw replay loaders, and direct link/unlink forms are absent;
- current raw examples that move here include manual Work Item ID loaders, release ID loaders, raw replay readers, raw JSON inspection, direct release scope link/unlink by id, and low-level patch helpers.

## Frontend Architecture

Target directory structure:

```text
apps/web/src/
  app/
    root.tsx
    providers.tsx
    routes.ts
    routes/
      _layout.tsx
      workbench/
      pipeline/
      work-items/
      specs/
      plans/
      packages/
      runs/
      reviews/
      releases/
      dev-tools/
  features/
    work-items/
    spec-plan/
    execution-packages/
    run-console/
    review-packets/
    releases/
    role-workbench/
    pipeline/
  shared/
    api/
    ui/
    layout/
    design-system/
    hooks/
    utils/
```

### React Router Framework Mode Requirements

This project must use React Router Framework Mode, not a hand-rolled BrowserRouter tab shell.

Implementation requirements:

- add `react-router` and `@react-router/node` as runtime dependencies, and `@react-router/dev` as a dev dependency for Framework Mode tooling;
- add `apps/web/react-router.config.ts` with:
  - `appDirectory: "src/app"`;
  - `buildDirectory: "dist/react-router"` or another explicit build directory chosen in the plan;
  - `ssr: false` because this slice is a SPA/framework migration, not a server-side migration;
- keep every route module under `apps/web/src/app/routes` or register it from `apps/web/src/app/routes.ts`;
- configure the React Router Vite plugin from `@react-router/dev/vite`; the Web Vite config must not remain a plain `@vitejs/plugin-react` SPA config;
- remove reliance on `@vitejs/plugin-react` as the only app plugin path; if it remains installed, it must not be the Framework Mode entry point;
- generate and use route types for params/search params where supported;
- update `apps/web/tsconfig.json` for React Router generated route types:
  - include `src/**/*.ts`, `src/**/*.tsx`, and `.react-router/types/**/*`;
  - set `compilerOptions.rootDirs` to include `.` and `./.react-router/types`;
- ensure `.react-router/` is ignored by git;
- replace the current `main.tsx` direct `createRoot(<App />)` entry with the Framework Mode entry pattern. If an entry file remains, it must mount React Router's framework hydration entry, not render the old `App`;
- move app-wide providers into `app/providers.tsx` or the root route component;
- make route-level error and loading boundaries part of the root/layout design;
- keep Vite as the build tool.

`app/routes.ts` names the route tree when a config file is used. It must not be a custom router competing with React Router Framework Mode.

Package scripts must move to the React Router CLI path:

- `dev`: `react-router dev`;
- `typecheck`: `react-router typegen && tsc --noEmit`;
- `build`: `react-router typegen && tsc --noEmit && react-router build`;
- Playwright/e2e startup must use the same `dev` script or serve the React Router build output, not a raw Vite-only harness.

The implementation plan must list concrete package additions for Tailwind, shadcn/Radix primitives, lucide-react, TanStack Query, React Hook Form, Zod resolver, TanStack Table, class name utilities, and test utilities.

Rules:

- `app/routes/*` owns page composition, route params, route-level loading/error boundaries, and URL search state.
- `features/*` owns business components, query hooks, mutation hooks, forms, and view models for that domain.
- `shared/ui` contains business-agnostic components.
- `shared/layout` contains product layout components.
- `shared/design-system` contains tokens, theme primitives, and component usage guidance.
- `shared/api` contains typed API clients, endpoint wrappers, query key factories, and shared request utilities.
- Feature modules may import `shared/*`.
- Shared modules must not import feature modules.
- Route modules may import feature modules and shared modules.

## Design System

The redesign includes a complete design system layer.

Target structure:

```text
apps/web/src/shared/design-system/
  tokens/
    colors.ts
    typography.ts
    spacing.ts
    radius.ts
    shadows.ts
    zIndex.ts
    motion.ts
  theme/
    css-variables.css
    tailwind-preset.ts
  docs/
    component-guidelines.md
```

Base UI:

```text
apps/web/src/shared/ui/
  button/
  icon-button/
  input/
  textarea/
  select/
  checkbox/
  tabs/
  badge/
  status-pill/
  card/
  panel/
  table/
  timeline/
  drawer/
  dialog/
  command-bar/
  empty-state/
  skeleton/
  toast/
```

Layout UI:

```text
apps/web/src/shared/layout/
  app-shell/
  sidebar-nav/
  topbar/
  page-header/
  detail-layout/
  split-pane/
  action-rail/
  section/
```

### Token Baseline

The implementation plan may tune exact values, but it must start from a concrete visual contract rather than a vague palette:

- color roles:
  - background: `#f6f8fb`;
  - surface: `#ffffff`;
  - surface-muted: `#f1f5f9`;
  - border: `#d9e2ec`;
  - text-primary: `#0f172a`;
  - text-secondary: `#475569`;
  - text-muted: `#64748b`;
  - primary: `#2563eb`;
  - primary-hover: `#1d4ed8`;
  - success: `#15803d`;
  - warning: `#b45309`;
  - danger: `#dc2626`;
  - info: `#0369a1`;
- typography:
  - font family: Plus Jakarta Sans preferred, otherwise system sans;
  - page title: 24/32, 600;
  - section title: 16/24, 600;
  - body: 14/22, 400;
  - compact/table: 13/20, 400 or 500 for labels;
  - caption/meta: 12/18, 500;
- spacing:
  - 4px base scale;
  - page padding: 24px desktop, 16px tablet/mobile;
  - section gap: 16-24px;
  - control gap: 8px;
- radius:
  - controls and panels: 6px;
  - dialogs/drawers: 8px;
  - no pill-shaped generic cards unless the component is a badge/status pill;
- shadows:
  - none for normal page sections;
  - subtle overlay shadow only for popovers, menus, dialogs, drawers, and raised active surfaces;
- z-index:
  - shell/topbar, popover/menu, drawer, dialog, toast are named tokens, not magic numbers.

### Component Anatomy

Every shared component must define its anatomy and allowed density:

- `Button`: variants for primary, secondary, ghost, danger, and destructive-confirm; supports loading and icon-leading/trailing states without width shift.
- `IconButton`: square touch target, lucide icon, accessible label, tooltip for non-obvious actions, no text-only fake icon controls.
- `Panel` / `Section`: page-level boundary with heading, optional description, action slot, and content slot; not a nested card container.
- `StatusPill` / `Badge`: color plus text label; never rely on color alone.
- `Table`: TanStack-backed data shape, sticky header where useful, empty/loading/error states, mobile card/list fallback where columns cannot fit.
- `ActionRail`: narrow object-command region with grouped actions, disabled reasons, high-risk confirmation patterns, and stable width on desktop.
- `Drawer` / `Dialog`: focus trap, close affordance, escape handling, labelled title/description, and validation summary slot.
- `Timeline`: normalized entry rows with source, time, summary, actor/system marker, and expandable details when raw evidence is product-relevant.

`shared/design-system/docs/component-guidelines.md` must include replacement rules for old `.panel` usage: old panels become `Section`, `DetailLayout`, `ActionRail`, `Table`, `Drawer`, or `DevToolsRawPanel` depending on intent. There is no generic compatibility wrapper named after the old CSS.

### Visual Direction

Use a clean SaaS operations dashboard style:

- professional;
- calm;
- high information density;
- strong hierarchy;
- no decorative hero/marketing patterns;
- no one-note purple or dark-blue dashboard palette;
- no gradient orbs or decorative blobs;
- no oversized hero typography inside workbench pages.

Suggested token direction:

- primary: blue used sparingly for focus and primary actions;
- accent: warm color for urgent CTA only, not broad backgrounds;
- background: neutral light gray/blue-gray surfaces;
- text: high-contrast slate/near-black;
- status colors: success, warning, danger, info with distinct hues and text labels;
- radius: restrained, generally 6-8px;
- shadow: subtle, only for overlays/drawers/popovers and active surfaces;
- motion: 150-250ms transitions, reduced-motion respected.

Typography:

- Prefer Plus Jakarta Sans if the project accepts an external font.
- Otherwise use the existing system stack through typography tokens.
- Do not scale font size with viewport width.
- Do not use negative letter spacing.
- Dense surfaces use compact but readable sizes.

Theme:

- Implement and polish light mode.
- Token structure reserves dark mode values.
- Do not implement dark-mode switching in this first slice.

## Data Flow And State Management

All server data flows through TanStack Query.

Because this slice uses React Router Framework Mode with `ssr: false`, route modules do not use server `loader` functions for object data except for an optional root shell loader that is safe at build time. Object data uses one of two patterns:

- preferred default: component-level TanStack Query hooks with route params/search params as inputs, plus page skeletons, empty states, and query error states inside the feature view;
- allowed where it improves route transitions: route `clientLoader` prefetches or hydrates TanStack Query cache, while the component still reads through query hooks.

Do not split the app into competing data models where route loaders own some server state and TanStack Query owns the rest. Route error boundaries catch render/module errors and not-found routing states; query errors render product error states inside the page or feature boundary.

Feature query hooks:

- `useWorkItemsQuery`
- `useWorkItemQuery`
- `useWorkItemBriefQuery`
- `useWorkItemCockpitQuery`
- `useSpecsQuery`
- `useSpecQuery`
- `useSpecHistoryQuery`
- `useSpecRevisionQuery`
- `usePlansQuery`
- `usePlanQuery`
- `usePlanHistoryQuery`
- `usePlanRevisionQuery`
- `useRoleWorkbenchQuery`
- `usePipelineQuery`
- `useRunsQuery`
- `usePackagesQuery`
- `usePackageQuery`
- `useRunSessionQuery`
- `useRunEventsQuery`
- `useReviewPacketsQuery`
- `useReviewPacketQuery`
- `useReleasesQuery`
- `useReleaseCockpitQuery`
- `useWorkItemReplayQuery`
- `useExecutionPackageReplayQuery`
- `useReviewPacketReplayQuery`
- `useReleaseReplayQuery`

Feature mutation hooks:

- `useCreateWorkItemMutation`
- `useConfirmWorkItemBriefMutation`
- `useCreateSpecMutation`
- `useCreatePlanMutation`
- `useCreateSpecRevisionMutation`
- `useCreatePlanRevisionMutation`
- `useSpecCommandMutation`
- `usePlanCommandMutation`
- `useGeneratePackagesMutation`
- `useCreateExecutionPackageMutation`
- `usePackageCommandMutation`
- `useRunPackageMutation`
- `useRunControlMutation`
- `useReviewDecisionMutation`
- `useCreateReleaseMutation`
- `usePatchReleaseMutation`
- `useReleaseCommandMutation`
- `useReleaseEvidenceMutation`
- `useAcknowledgeReleaseTestAcceptanceMutation`
- `useReleaseScopeMutation`

Backend/read-model gaps discovered during implementation must be made explicit in the plan. The UI must either add the needed query endpoint in the same feature branch or render a truthful degraded state. It must not invent complete pipeline/run/spec/plan/package/review list data on the client.

Mutation success invalidates specific query keys only. Do not use global "reload all" behavior as the main data model.

URL state:

- object identity comes from route params;
- filters go in search params;
- selected role and project can be represented in URL where useful;
- local tab/drawer state stays local unless deep-linking is required.

Shared context:

- actor context;
- project context;
- environment/runtime state;
- feature flag for Dev Tools.

Run Console:

- SSE stream lifecycle lives inside the run-console feature.
- Cursor and reconnect handling must not live in app root.
- The feature exposes a narrow view model for visible events, stream status, input commands, and active run metadata.

## Migration Strategy

Use one-shot replacement from the user's perspective.

Implementation may internally build the new architecture in steps, but the final branch must:

- remove the old default workbench UI;
- not include `/legacy`;
- not expose old and new routes side by side;
- not leave old CSS classes as active page styling;
- delete unused old workbench components, old debug CSS, and stale tests that assert old DOM compatibility;
- keep only reusable pure helpers after moving them to feature modules or shared utilities;
- update tests to target the new UI architecture rather than old DOM compatibility.

Old API client code can be moved and refactored. It must not remain as a broad root-level mixed client with page-specific logic leaking everywhere.

No-legacy verification must include scans for:

- `/legacy` routes or labels;
- `.panel`, `.workbench-grid`, and other removed debug layout classes in active CSS/JSX;
- imports from old monolithic `App.tsx` into route or feature modules;
- old manual ID loader controls on product routes;
- stale test names that require the previous one-page workbench DOM.

## Dev Tools Boundary

Dev Tools are for raw/debug operations:

- manual ID loading;
- raw replay reads;
- direct low-level link/unlink;
- direct patch/debug helpers;
- API smoke helpers;
- payload inspection.

They are hidden unless:

- development mode; or
- explicit configuration enables them.

Dev Tools must not include product governance actions that users need in normal workflow. Those actions live on the relevant object page with proper UX.

The explicit configuration is the same `import.meta.env.DEV` / `VITE_FORGELOOP_ENABLE_DEV_TOOLS` contract described above. A disabled Dev Tools route must not silently redirect to product pages because that can hide broken links; it should render a stable not-found/not-enabled route state that is easy to test.

## Accessibility And Responsiveness

Required:

- semantic HTML;
- route and page headings in a logical hierarchy;
- skip-to-main link for keyboard users;
- visible focus states;
- tab order matching visual order;
- keyboard-accessible dialogs/drawers;
- no keyboard traps;
- loading skeletons or explicit loading states for route/page data;
- predictable browser back behavior;
- labels for all form controls;
- error states that do not rely only on color;
- color contrast suitable for workbench reading;
- responsive layouts for 375, 768, 1024, and 1440px viewports;
- no horizontal scroll on mobile;
- stable hover states that do not shift layout.

### Responsive Layout Contract

- App shell:
  - desktop >= 1200px: persistent left sidebar, topbar, main content, optional right Action Rail;
  - tablet 768-1199px: collapsible sidebar, topbar keeps search/project/actor controls compact, Action Rail becomes an inline section or drawer;
  - mobile <= 767px: sidebar becomes a sheet/bottom navigation trigger, topbar prioritizes page title/context, global search opens in a command dialog.
- Workbench:
  - desktop: two-column queue + preview;
  - tablet: queue and preview use a resizable or stacked split with preview below when width is constrained;
  - mobile: queue is the primary list; item preview opens as a route/detail sheet, not a squeezed side panel.
- Object detail pages:
  - desktop: header + tabs + main content + Action Rail;
  - tablet/mobile: Action Rail collapses below the header or into a sticky action drawer; tabs become horizontally scrollable with visible focus and no page overflow.
- Run detail:
  - desktop: metadata rail, event stream, artifact/check panel as three regions;
  - tablet: metadata becomes collapsible, stream remains primary, artifacts below/right depending on available width;
  - mobile: stream first, metadata/artifacts/checks as tabs or accordions.
- Tables:
  - desktop/tablet: normal data table;
  - mobile: responsive row cards or prioritized columns, with no horizontal page scroll.

### Accessibility Gates

Implementation is not complete until automated and manual checks cover:

- keyboard traversal from skip link through sidebar, topbar, page tabs, table rows, action rail, and dialogs;
- focus trap and focus return for every drawer/dialog;
- visible focus states for buttons, icon buttons, links, table rows, tabs, menu items, and destructive confirmations;
- skip-to-main link visible on focus and tested on at least `/workbench`, `/runs/:runSessionId`, and `/releases/:releaseId`;
- axe or equivalent automated checks on the main route set;
- contrast checks for token pairs, status pills, disabled states, selected rows, and warning/danger surfaces;
- form validation announced with text, not color alone.

## Testing Strategy

### Unit And View-Model Tests

Cover:

- role queue display mapping;
- role action labels and disabled reasons;
- status/action label mapping;
- release blocker grouping;
- run event rendering;
- form payload parsing;
- query key factories;
- URL search param parsing.

### Component Tests

Cover:

- AppShell navigation;
- DetailLayout and ActionRail;
- Workbench queue;
- Work Item detail tabs;
- Spec & Plan revision drawer;
- direct Spec/Plan detail routes;
- Releases list;
- Execution Package overview;
- package generation/manual creation flows;
- Run Console;
- Review Packet detail;
- Release Cockpit;
- create/edit release flows;
- release scope picker add/remove flows;
- Test Acceptance acknowledgement flow;
- Dev Tools visibility flag.

### API / Query Tests

Cover:

- query key stability;
- mutation invalidation targets;
- loading states;
- empty states;
- error states;
- actor/project context propagation.

### Test Harness Migration

Existing tests that server-render the old `App` must be replaced with router-aware test utilities. The new harness must provide:

- a React Router Framework Mode route stub or route module test helper for isolated route tests;
- QueryClient provider setup with deterministic cache cleanup;
- actor/project/Dev Tools flag provider setup;
- test fixtures for workbench projections, cockpit responses, replay entries, release cockpit, and run events;
- route-param and search-param helpers for direct deep-link tests.

E2E tests must boot the Web app through `pnpm --filter @forgeloop/web dev` or a built React Router artifact. They must not start a raw Vite-only server config that bypasses React Router Framework Mode.

### E2E And Visual Smoke

Use Playwright to verify:

- `/workbench` loads without horizontal overflow at 375, 768, 1024, and 1440px;
- Workbench can navigate to a Work Item detail page;
- Work Item Owner queue surfaces triage/brief/readiness state or an explicit degraded intake state;
- Work Item detail shows lifecycle tabs;
- Work Item detail shows Brief / Intake and Validation sections without debug/raw controls;
- Spec & Plan page opens revision actions in a drawer/dialog;
- Spec and Plan detail routes show History / Timeline sections or a truthful degraded state;
- a Work Item with no Spec can create a Spec, then create a Plan when appropriate;
- Spec and Plan detail/revision routes load directly;
- Package page exposes run/rerun/force rerun in a productized action area;
- Specs, Plans, Packages, and Reviews list pages load directly or show truthful degraded states;
- package generation and manual package creation are reachable outside Dev Tools;
- Run Console renders events and input controls without overlap;
- `/runs` loads directly or shows its truthful deep-link/degraded state;
- `/runs/:runSessionId` deep links to an individual run;
- Release Cockpit blockers/checklist/evidence are readable;
- `/releases` loads release rows through `listReleases`, supports filters, and navigates rows to Release Cockpit without manual release-id loading;
- release creation and edit details are productized outside Dev Tools;
- release scope add/remove by picker is productized outside Dev Tools;
- release Test Acceptance acknowledgement is productized outside Dev Tools;
- Dev Tools are hidden by default and visible when explicitly enabled;
- Dev Tools disabled negative checks pass on Workbench, Work Item detail, Package detail, Run detail, Review detail, Releases list, and Release detail;
- no blank screens after route navigation;
- no primary text overflow in buttons, tabs, tables, or action rails.

### Visual QA Gates

Each primary route needs a desktop and mobile screenshot artifact before completion:

- viewports: 375, 768, 1024, and 1440px for `/workbench`, `/pipeline`, `/work-items`, `/work-items/:id`, `/work-items/:id/spec-plan`, `/specs`, `/plans`, `/packages`, `/packages/:id`, `/runs`, `/runs/:id`, `/reviews`, `/reviews/:id`, `/releases`, and `/releases/:id`;
- screenshot review checks: no card-in-card page composition, no old debug panel styling, no raw controls on product routes, no overlapped text, no clipped action labels, no hidden focus outline on visible focus states;
- automated DOM/layout checks where practical: body scroll width <= viewport width, key bounding boxes do not overlap, buttons/tabs keep stable dimensions on hover/loading, and empty/loading/error states fit their containers;
- visual smoke must include at least one high-density data state and one empty/degraded state for Workbench, Pipeline, Runs list, Releases list, and Release Cockpit.

## Acceptance Criteria

- The app uses React Router Framework Mode with product route boundaries.
- `react-router.config.ts` explicitly sets `appDirectory`, `buildDirectory`, and `ssr: false`; Web scripts use the React Router CLI and typegen path.
- `apps/web/tsconfig.json` includes `.react-router/types/**/*`, configures `rootDirs` for generated route types, and `.react-router/` is gitignored.
- The app has a complete shared design system layer.
- The design system defines concrete tokens, component anatomy, layout primitives, and old `.panel` replacement rules.
- The app has a product AppShell, Sidebar, Topbar, PageHeader, DetailLayout, and ActionRail.
- The default route is a Work Item Owner-oriented Workbench.
- Product role labels map cleanly to backend workbench ids without leaking `Intake` into user-facing UI.
- Workbench rows preserve Work Item kind/surface/object type rather than treating Work Item Owner as a coarse work-item type.
- Work Item intake/brief readiness is represented in Workbench and Work Item detail, with backend gaps explicitly implemented or degraded.
- Every current main-flow capability has a new page or drawer/dialog location.
- Every primary navigation item has a direct route that loads real data or an explicit degraded state backed by the implementation plan.
- Spec, Plan, SpecRevision, PlanRevision, ExecutionPackage, RunSession, ReviewPacket, Release, and Work Item have direct route coverage or an explicitly documented API-backed route limitation resolved in the implementation plan.
- Create Spec, Create Plan, generate packages, create manual package, create release, and edit release details remain productized flows.
- Release scope add/remove and Release Test Acceptance acknowledgement remain productized flows.
- Execution Package and Review Packet detail pages include productized Timeline/Replay views.
- Spec and Plan detail pages include productized History / Timeline views backed by replay endpoints or parent Work Item replay/revision data.
- Pipeline explicitly includes Intake, Spec / Plan, Execution, Review, Integration / Cross-end Validation, Test / Acceptance, Release, and Observation.
- Pipeline and Runs list use explicit backend/query read models or truthful degraded states documented in the plan.
- The current monolithic `App.tsx` workbench shape is removed.
- The old debug-panel CSS system is removed as active and dead page styling.
- No `/legacy` route exists.
- Dev Tools are hidden unless development or explicit configuration enables them.
- Dev Tools disabled negative tests prove raw/manual controls are absent from product routes.
- Main product pages do not expose raw/debug controls.
- Product governance actions remain visible on the relevant product pages.
- All main objects are deep-linkable.
- Server state uses TanStack Query hooks rather than app-root reload orchestration or competing server-loader ownership.
- Complex forms use React Hook Form plus Zod or an equivalent typed form boundary.
- Structured tables use TanStack Table or shared table primitives, not ad hoc div grids.
- All click targets use semantic buttons/links.
- All primary pages pass responsive visual smoke at 375, 768, 1024, and 1440px.
- Accessibility gates pass for keyboard traversal, focus traps, skip link, contrast, labels, and automated axe checks.
- Test harnesses exercise route modules through React Router Framework Mode rather than old `App` SSR snapshots or raw Vite startup.
- `pnpm test`, `pnpm build`, and Web visual smoke checks pass.

## References

- PRD: `docs/PRD_v1.md`
- Current app: `apps/web/src/App.tsx`
- Current styles: `apps/web/src/styles.css`
- Delivery boundary design: `docs/superpowers/specs/2026-05-16-delivery-boundary-and-role-workbench-design.md`
- React Router framework modes: https://reactrouter.com/start/modes
- Next.js App Router docs: https://nextjs.org/docs/app
- shadcn/ui docs: https://ui.shadcn.com/docs
- TanStack Query docs: https://tanstack.com/query/latest/docs/framework/react/overview
