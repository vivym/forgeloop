# AI-Native Project Management UX Redesign Design

## Status

User-approved design draft.

This spec defines the next Web product UX redesign for ForgeLoop. It supersedes the current skeletal project-management UI direction where necessary and tightens `2026-05-23-project-management-ia-authoring-design.md` around the AI-native Development Plan flow.

The project is not launched. Implementation must favor the correct product and frontend architecture over compatibility. Do not keep historical navigation, old Work Item abstractions, generic task backlogs, old/new UI switches, or compatibility surfaces when they conflict with this spec.

## Context

ForgeLoop is an AI-native research and delivery operating system. The PRD defines a system where humans define goals, judge boundaries, review artifacts, supervise execution, and approve quality; Codex workers and AI agents generate artifacts and execute plans with traceable evidence.

The current Web UI has moved away from the old internal workbench, but it is still not a usable project-management product:

- pages are visually sparse and table-heavy;
- `Requirements`, `Tasks`, and `Bugs` use near-identical generic list patterns;
- `Dashboard`, `Board`, and `Reports` are mostly placeholders;
- `Requirement -> Spec -> Plan` is still split into separate surfaces rather than a guided workflow;
- the product does not yet express the Superpowers-style boundary-clarification workflow before Spec and Plan generation;
- AI generation, Codex worker execution, interruption, continuation, and human review are not first-class product actions;
- the layout lacks the mature product qualities users expect from tools such as Linear, GitHub Projects, Jira Product Discovery, and Notion Projects: dense navigation, multiple views over shared objects, structured planning tables, document-plus-properties workspaces, and clear action surfaces.

The UI must become a premium, information-dense operations product. It should look and feel like a serious project-management system for AI-native delivery, not a debug console, a blank table shell, or a generic ticket tracker.

## Goals

- Make typed product objects first-class: Initiatives, Requirements, Bugs, Tech Debt, Development Plans, Specs and Execution Plans, active Executions, Releases, and Reports.
- Treat `Development Plan` as the central product planning object between source objects and Spec/Plan generation.
- Support manual Development Plan authoring and AI-assisted Development Plan generation.
- Ensure Requirements, Bugs, Tech Debt items, and Initiative slices create or link Development Plans before Spec/Plan generation.
- Generate Spec and Execution Plan documents from Development Plan rows only after an interactive brainstorming boundary-confirmation flow.
- Let Codex workers execute directly from an approved Execution Plan document in this slice.
- Defer structured executable task extraction; do not require a top-level task backlog for this redesign.
- Make role lenses first-class without creating role silos.
- Make AI actions, context provenance, artifact review, execution control, continuation, code review, QA handoff, and release readiness visible product workflows.
- Establish a high-quality visual system: mature layout, compact density, polished states, Tailwind-first implementation, shadcn/Radix-style primitives, lucide icons, and MDXEditor-backed document authoring.

## Non-Goals

- No Evolution Loop / learning-rule authoring implementation in this slice.
- No real-time collaborative editing.
- No external Jira, Linear, GitHub Issues, Notion, or document-system sync.
- No generic custom-field builder.
- No structured executable task extraction from Execution Plan documents in this slice.
- No top-level generic Work Items page.
- No public "Work Item Owner" product surface.
- No direct Requirement/Bug/Tech Debt -> Spec/Plan generation path that bypasses a Development Plan row.
- No direct Codex execution from an unreviewed Development Plan, unconfirmed brainstorming scope, draft Spec, or draft Execution Plan.
- No old/new UI switch, compatibility route family, or fallback shell.
- No primary navigation entry for raw Execution Packages, Run Sessions, Review Packets, Replay, or traces.
- No primary Replay product surface in this slice. Replay remains a report/evidence concept under Reports, Releases, and object timelines unless a future product spec defines a non-raw Replay surface.
- No decorative marketing layout, oversized hero composition, card-in-card page layout, emoji icons, or one-note visual theme.

## External Product Inspiration

ForgeLoop should borrow mature layout patterns, not clone a competitor.

- Linear: compact left navigation, dense object lists, high-signal detail pages, quick operations, and understated polish.
- GitHub Projects: table/board/roadmap style views over the same underlying objects.
- Jira Product Discovery: discovery-to-delivery linkage and a planning layer between idea and implementation.
- Notion Projects: document authoring plus structured properties and database-like views.

ForgeLoop's differentiator is that the planning layer feeds a governed AI-native delivery loop: brainstorming boundary confirmation, Spec generation, Execution Plan generation, Codex worker execution, human code review, QA handoff, and release readiness.

## Product Object Model

### Source Objects

Source objects are business or engineering concerns that need delivery:

- Initiative;
- Requirement;
- Bug;
- Tech Debt.

Each source object has typed intake, structured fields, narrative Markdown, attachments, evidence, release links, and role-specific lenses.

Source objects do not directly generate Spec or Execution Plan documents. They create or link Development Plans.

### Development Plan

`Development Plan` is a first-class product object and the main planning surface between a source object and AI execution.

It is not necessarily AI-generated. It can be:

- manually created by Product, Tech Lead, Developer, or Manager where permissions allow;
- generated by Codex from a source object, PRD, repository context, historical requirements, linked bugs, existing Specs/Plans, evidence, and user guidance;
- refined through mixed human editing and AI regeneration.

Product UI should present Development Plan as a mature planning table or view, not as a chat transcript and not as a hidden generated artifact.

Development Plan rows are `Development Plan Items`. They are rows inside the Development Plan, not a separate sequential workflow stage.

### Development Plan Item

A Development Plan Item is one independently reviewable and executable unit inside a Development Plan.

It is not a structured executable Task in this slice. It should carry enough structured data for review and execution tracking:

- title;
- summary;
- driver actor where the item needs an accountable human;
- responsible role for lens routing;
- reviewer actor where review is required;
- risk;
- dependency hints;
- affected surfaces/repos/modules;
- boundary status;
- Spec status;
- Execution Plan status;
- execution status;
- review status;
- QA handoff status;
- release impact;
- links to generated artifacts and evidence.

Each Development Plan Item independently moves through:

`Boundary brainstorming -> Spec generation/review -> Execution Plan generation/review -> Codex execution from approved Execution Plan -> Code review -> QA/Test handoff`.

### Spec Document

Spec is generated or edited for a Development Plan Item after boundary brainstorming is complete.

Spec defines:

- problem and source-object context;
- scope and out-of-scope boundaries;
- technical boundary and contracts;
- acceptance and test strategy;
- risks, assumptions, dependencies, and unresolved questions.

Tech Lead or the appropriate reviewer must approve the Spec before Execution Plan generation can be treated as ready.

### Execution Plan Document

`Execution Plan document` is the Superpowers-style plan generated for a Development Plan Item after the Spec is reviewed.

This naming avoids ambiguity with `Development Plan`:

- Development Plan: product planning table/container.
- Execution Plan document: generated implementation plan document for a Development Plan Item.

Execution Plan document defines:

- implementation sequence;
- validation strategy;
- allowed scope and files/surfaces where available;
- test and quality gates;
- rollback or recovery notes;
- expected artifacts and handoff criteria.

When approved, Codex worker execution can run directly from the Execution Plan document. Structured task extraction is deferred.

### Execution

Execution is a product-facing supervision surface over Codex worker activity.

It may be backed by Execution Packages, Run Sessions, Review Packets, traces, and PR metadata, but users should not need to start from those raw runtime objects.

Execution must show:

- worker status;
- current step;
- progress and last event;
- generated diff/PR links;
- test/check results;
- continuation availability after interruption or failure;
- interrupt/pause/continue controls where allowed;
- review evidence and QA handoff status.

## Target Flow

### Source Object To Development Plan

Every Requirement, Bug, Tech Debt item, or Initiative slice should have a clear Development Plan entry point.

Allowed paths:

- create a Development Plan manually;
- generate a draft Development Plan with Codex;
- link to an existing Development Plan;
- add rows to an existing Development Plan.

Disallowed paths:

- generate Spec directly from a source object without a Development Plan Item;
- generate Execution Plan directly from a source object without a Development Plan Item;
- start Codex execution from source-object narrative or unreviewed Development Plan content.

### Development Plan Table

The Development Plan UI should behave like a mature planning table:

- rows are compact and scannable;
- columns are configurable by view/lens;
- inline editing is supported for safe fields;
- row detail opens in a drawer or split pane;
- filters support driver actor where applicable, responsible role, reviewer actor, risk, status, dependency, surface, Spec status, Execution Plan status, execution status, review status, QA status, and release impact;
- views can show table, board, and compact timeline later, but table is the first required implementation shape;
- empty state explains how to create or generate the first plan.

AI generation is an action on the Development Plan, not the definition of the Development Plan.

### Boundary Brainstorming

Before Spec generation, each Development Plan Item must pass a boundary-confirmation workflow compatible with the Superpowers brainstorming pattern.

The workflow:

1. Codex runtime collects context.
2. Codex asks focused questions to clarify scope, constraints, acceptance, risks, repository boundaries, and validation.
3. Human answers questions.
4. Codex proposes a confirmed boundary summary.
5. Human approves or revises the boundary.
6. The approved boundary becomes the input to Spec generation.

The UI must preserve:

- context manifest;
- questions and answers;
- decisions;
- boundary summary;
- approval state;
- who answered or approved;
- timestamps;
- links back to source object and Development Plan Item.

The product persistence contract must include a `BrainstormingSession` record before Spec generation can be enabled. Summary-only persistence does not satisfy the gate.

Minimum persisted `BrainstormingSession` fields:

- id;
- source object typed ref and revision;
- Development Plan id;
- Development Plan Item id and revision;
- context manifest id and revision;
- question list with question text, author/runtime identity, timestamp, and status;
- answer list with answer text, answering actor, timestamp, and linked question id;
- decision list with decision text, deciding actor or runtime identity, timestamp, and rationale;
- approval state;
- boundary summary id and revision;
- approver actor;
- approved_at timestamp when approved.

Minimum persisted `BoundarySummary` fields:

- id and revision;
- BrainstormingSession id;
- Development Plan Item id and revision;
- confirmed scope;
- confirmed out-of-scope boundaries;
- accepted assumptions;
- open risks;
- validation expectations;
- approval actor and timestamp.

Full raw runtime transcript storage can be deferred, but the product gate must not depend on unavailable raw runtime state. The persisted BrainstormingSession and BoundarySummary must be sufficient to prove that Codex asked questions, humans answered, decisions were recorded, and an approved boundary was used as Spec-generation input.

Spec generation must be disabled until the boundary is confirmed.

### Spec Generation And Review

Spec generation is a product command on a Development Plan Item after boundary confirmation.

The command must show:

- context sources used;
- generation status;
- draft version;
- reviewer;
- open comments or requested changes;
- approve/reject/regenerate actions.

Tech Lead review is explicit. Product, Developer, QA, Release Owner, and Manager lenses may view or comment where useful, but Tech Lead remains the primary Spec approval role unless the object type defines a different technical reviewer.

### Execution Plan Generation And Review

Execution Plan document generation is a product command after Spec approval.

It must show:

- the approved Spec revision used;
- context sources used;
- generated plan revision;
- validation strategy;
- review state;
- requested changes;
- approval state.

Codex execution must be disabled until the Execution Plan document is approved.

### Codex Worker Execution

After Execution Plan approval, the Development Plan Item can start Codex worker execution from the approved Execution Plan document.

Developer or Execution supervisor UX must support:

- start execution;
- monitor worker progress;
- inspect logs/events;
- interrupt or pause where the runtime supports it;
- continue after interruption, failure, timeout, or context compaction;
- request narrow fix loops;
- view diff, PR, tests, checks, and evidence;
- mark ready for code review only when required checks exist.

The UI must not imply that an execution is complete until verification evidence exists.

### Code Review, QA/Test, Release

Code review happens after Codex execution produces reviewable output.

QA/Test handoff happens only after code review passes or an explicit audited exception allows early QA preparation.

QA handoff should include:

- source object;
- Development Plan Item;
- approved Spec;
- approved Execution Plan;
- acceptance criteria;
- test strategy;
- test evidence;
- known risks;
- changed surfaces;
- release impact.

Release readiness uses evidence, not status labels alone.

## Role Lens Model

ForgeLoop has one shared object graph and multiple role lenses.

Role lens changes:

- default landing page;
- default object tab;
- visible metadata emphasis;
- table columns;
- primary action;
- action rail content;
- empty states and warnings.

Role lens must not:

- create separate copies of objects;
- change the URL identity of the object;
- hide required governance gates;
- bypass permissions;
- replace typed product objects with role silos.

### Product Lens

Default focus:

- source-object brief;
- problem, outcome, scope, acceptance;
- stakeholder decisions;
- Development Plan readiness;
- release intent.

Primary actions:

- edit brief;
- clarify acceptance;
- approve or request changes to source-object narrative;
- request Development Plan;
- review QA acceptance outcome.

### Tech Lead Lens

Default focus:

- Development Plan table;
- boundary brainstorming;
- Spec review;
- Execution Plan review;
- architecture and contract risk.

Primary actions:

- create/refine Development Plan rows;
- start or continue boundary brainstorming;
- generate Spec;
- review and approve Spec;
- generate Execution Plan;
- review and approve Execution Plan.

### Developer / Execution Supervisor Lens

Default focus:

- approved Execution Plan;
- active Codex worker runs;
- continuation state;
- diffs, PRs, tests, checks, and review feedback.

Primary actions:

- start execution;
- interrupt or continue execution;
- request narrow fix loop;
- inspect failure;
- prepare code review handoff.

### QA Lens

Default focus:

- acceptance matrix;
- test strategy from Spec/Execution Plan;
- bug reproduction and regression risk;
- verification evidence;
- release-blocking quality gaps.

Primary actions:

- request testability changes;
- verify;
- block QA handoff;
- accept QA handoff;
- add evidence.

### Release Owner Lens

Default focus:

- release scope;
- readiness gates;
- rollout and rollback;
- open blockers;
- observation state.

Primary actions:

- approve release inclusion;
- hold release;
- request additional evidence;
- start observation.

### Manager Lens

Default focus:

- flow health;
- blocked rows;
- aging;
- risk concentration;
- role load;
- release confidence;
- trend/report links.

Primary actions:

- unblock;
- escalate;
- reprioritize;
- inspect bottleneck reports.

## Target Navigation

Primary navigation should be grouped and product-oriented:

Home:

- Dashboard;
- My Work.

Discovery:

- Initiatives;
- Requirements;
- Bugs;
- Tech Debt.

Planning:

- Development Plans;
- Specs & Execution Plans.

Delivery:

- Executions;
- Board;
- Releases.

Intelligence:

- Reports.

Dev Tools remains development-only and hidden outside explicit dev configuration.

Do not keep a generic `Work Items` primary entry. Do not expose raw packages, runs, reviews, Replay, or traces as primary navigation. Do not expose a top-level structured Task backlog in this slice; structured task extraction is deferred.

Replay is not implemented as primary navigation in this slice. Raw traces and replay tooling remain dev-only. Any future Replay product surface must be scoped by Reports, Release evidence, or object timelines and must not expose raw runtime traces as the entry model.

## Page Designs

### My Work

`My Work` is the default role-aware inbox over shared objects and plan items.

It should answer:

- What needs my attention?
- Which object or Development Plan Item needs action?
- Why am I seeing it?
- What happens if I act?

Rows must expose concrete target types:

- Requirement;
- Bug;
- Tech Debt;
- Initiative;
- Development Plan;
- Development Plan Item;
- Spec;
- Execution Plan;
- Execution;
- QA Handoff;
- Release.

### Source Object Workspace

Source object detail pages use an object workspace layout:

- header with object type, title, state, risk, driver, release, freshness;
- role lens segmented control;
- metadata strip;
- tabs for Brief, Development Plan, Specs & Execution Plans, Execution, QA, Release, Evidence;
- main canvas with MDXEditor-backed narrative where the object owns narrative;
- structured field panel;
- right action rail with next best action, gates, blockers, related work, and role-specific commands;
- activity and evidence timeline.

The `Specs & Execution Plans` and `Execution` tabs on a source object page are relationship projections. They summarize downstream Development Plan Items and their artifacts. They must not host direct "generate Spec", "generate Execution Plan", or "start execution" commands against the source object itself.

Any action to generate Spec, generate Execution Plan, or start execution must be scoped to a selected Development Plan Item and must deep-link or open that Development Plan Item gate surface. If prerequisites are missing, the source object projection must show a disabled action with an explanation and a link to create/select the required Development Plan Item.

### Development Plan Page

Development Plan page should provide:

- source-object context;
- plan table;
- saved views and filters;
- AI-assisted generation and regeneration actions;
- row detail drawer/split pane;
- status gates per row;
- links to brainstorming, Spec, Execution Plan, execution, review, QA, and release evidence.

The page must support both manual and AI-assisted authoring.

### Development Plan Item Detail

Development Plan Item detail should provide:

- row summary and structured fields;
- boundary brainstorming panel;
- Spec document panel;
- Execution Plan document panel;
- execution supervision panel;
- review and QA handoff panel;
- evidence timeline.

This can be implemented as a drawer from the Development Plan table or as a deep-linkable page. If implemented as a drawer first, it must still have a stable deep link for review and execution actions.

### Specs & Execution Plans Queue

This queue replaces a generic document list with governance queues:

- Spec needs generation;
- Spec needs review;
- Spec approved;
- Execution Plan needs generation;
- Execution Plan needs review;
- Execution Plan approved;
- stale after source-object or Development Plan change;
- blocked.

Rows must show source object, Development Plan Item, reviewer, risk, age, and next action.

### Executions

Executions page is a product-level supervision queue, not a raw runtime object browser.

`Executions` is required as a first-slice primary navigation item and route. It is the cross-project supervision queue for Codex worker work linked to approved Execution Plan revisions. It is not optional and must not be folded away into only Development Plan Item detail or `My Work`.

It should show:

- active Codex worker runs;
- interrupted or resumable runs;
- failed runs needing attention;
- completed runs awaiting code review;
- code review changes requested;
- QA handoff pending.

It may link to raw packages/runs/reviews in evidence contexts, but those raw objects are not the primary product entry.

### Board

Board should support cross-object work across source objects and Development Plan Items.

It must not assume every card has the same schema. Cards should expose type, lens-relevant status, risk, blocker, and next action.

### Reports

Reports should cover:

- Development Plan throughput;
- brainstorming bottlenecks;
- Spec review aging;
- Execution Plan review aging;
- Codex execution success/failure/continuation;
- code review turnaround;
- QA handoff readiness;
- release readiness;
- quality and bug escape.

## AI-Native UX Requirements

### Context Manifest

Every AI-generated Development Plan, Spec, and Execution Plan must expose a context manifest.

The manifest should list:

- source object and revision;
- Development Plan id and revision when generated from a Development Plan;
- Development Plan Item id and revision when generated from a Development Plan Item;
- BrainstormingSession id and revision when generating Spec or downstream artifacts;
- approved BoundarySummary id and revision when generating Spec or downstream artifacts;
- boundary approver actor and approval timestamp when generating Spec or downstream artifacts;
- approved Spec revision id when generating an Execution Plan;
- PRD or product docs used;
- repository map or code paths used;
- historical related requirements or bugs;
- existing Specs/Execution Plans;
- evidence and attachments;
- actor guidance;
- Codex runtime or worker identity;
- generation timestamp.

The UI may summarize this by default, but a reviewer must be able to inspect it.

Spec context manifests must include the governing Development Plan, Development Plan Item revision, BrainstormingSession, approved BoundarySummary revision, and boundary approver. Execution Plan context manifests must include the approved Spec revision plus that upstream chain. A generated artifact without this chain must remain draft/error and must not satisfy review or execution gates.

### Regeneration With Feedback

Regeneration must be explicit and versioned.

Users can:

- add feedback;
- choose whether to preserve prior decisions;
- compare generated versions;
- accept, reject, or request another pass.

Regeneration must not overwrite approved artifacts silently.

### Versioning And Diff

Development Plan rows, brainstorming boundary summaries, Spec documents, and Execution Plan documents need visible version history or at minimum revision history sufficient for review.

Spec and Execution Plan document diff should compare Markdown revisions.

### Action Rail

The action rail is the primary place for role-specific commands.

It must show:

- next best action;
- why the action is enabled or disabled;
- blocking gates;
- stale context warnings;
- assigned reviewer/driver;
- safe destructive actions in confirmations or dialogs;
- links to related artifacts.

### Continuation UX

Codex worker execution must treat continuation as a first-class workflow.

When a run is interrupted, failed, timed out, or paused, the UI should show:

- last known step;
- last evidence;
- failure reason;
- whether continuation is allowed;
- what context will be passed to continuation;
- continue action;
- option to request a narrower fix loop.

## Authoring UX

### MDXEditor

Narrative documents continue to use MDXEditor through the ForgeLoop wrapper.

The wrapper must remain the only way product pages integrate MDXEditor.

Required capabilities:

- WYSIWYG Markdown editing;
- Markdown source mode;
- toolbar with lucide icons where possible;
- image upload, paste, and drag/drop through Attachment API;
- attachment picker;
- validation errors connected to unsupported content or unsafe references;
- autosave draft where appropriate;
- explicit save/submit where lifecycle gates require review;
- revision history and diff where available;
- keyboard-accessible controls and visible focus states.

### Structured Fields Stay Structured

Do not push structured planning data into Markdown when it must support filtering, workflow, reporting, or governance.

Structured fields include:

- source object type;
- Development Plan;
- Development Plan Item status fields;
- driver actor where the item needs an accountable human;
- responsible role for lens routing;
- reviewer actor for Spec, Execution Plan, and code-review gates;
- risk;
- dependency;
- affected surfaces/repos/modules;
- Spec status;
- Execution Plan status;
- execution status;
- review status;
- QA handoff status;
- release impact.

Markdown holds narrative reasoning, explanation, decisions, and evidence references.

## Visual System

### Product Feel

ForgeLoop should feel like a premium operational SaaS product:

- calm;
- dense;
- fast;
- precise;
- document-aware;
- workflow-aware.

It must not feel like:

- a debug console;
- a toy kanban board;
- a marketing landing page;
- a sparse form scaffold;
- a generic ticket tracker.

### Layout Rules

Use:

- persistent grouped left navigation;
- sticky topbar with command search, project, role lens, and runtime state;
- object workspace layout;
- role lens segmented control;
- table-first Development Plan surface;
- right action rail;
- drawers/dialogs for focused commands;
- panels and sections with restrained 8px-or-less radius.

Avoid:

- card-in-card page composition;
- huge empty cards;
- hero-scale type inside app surfaces;
- decorative gradients/orbs/blobs;
- layout shifts on hover;
- horizontal scroll on common viewports.

### First-Slice Visual Contract

The first implementation must satisfy a concrete layout contract for the key routes so the redesign cannot regress into sparse skeleton cards.

#### Source Object Workspace

Desktop at 1024px and wider:

- persistent grouped left navigation;
- sticky topbar;
- object header with title, type, state, risk, driver, freshness, and role lens visible in the first viewport;
- tab row visible in the first viewport;
- main workspace uses a two-column composition: document/primary content plus structured facts or relationship summary;
- right action rail is visible or docked at 280-340px when viewport width allows.

Mobile and tablet below 1024px:

- left navigation collapses without overlaying content by default;
- action rail becomes a section below primary content or an accessible drawer;
- role lens remains horizontally scrollable without clipping labels;
- no horizontal page scroll.

The first viewport must show real object context and at least one actionable next step. It must not show only a title plus empty card.

#### Development Plan Page

Desktop:

- table-first layout;
- row height target 44-56px for normal rows;
- visible columns must include plan item, responsible role/driver where applicable, boundary status, Spec status, Execution Plan status, execution status, risk, and next action;
- filters and saved views sit above the table in a compact toolbar;
- row detail opens in a drawer or split pane that does not cover the entire table at desktop width;
- empty state must fit inside the table surface and offer manual create plus AI-assisted generate actions.

Mobile/tablet:

- rows can become compact cards, but each card must still show boundary, Spec, Execution Plan, execution status, risk, and next action;
- drawer can become full-screen below 768px.

#### Development Plan Item Detail

Desktop:

- page or drawer must show the row summary, gate state, and next action in the first viewport;
- boundary brainstorming, Spec, Execution Plan, execution, review, QA, and evidence sections must be reachable without losing the item context;
- action rail or sticky action footer must expose the current enabled/disabled gate with reason.

#### Specs & Execution Plans Queue

- queue rows target 44-56px on desktop;
- rows must show artifact type, source object, Development Plan Item, reviewer, age, risk, stale/blocked state, and next action;
- queue groups must be visually separated without large empty cards.

#### Executions

- first viewport must show active/resumable/failed/review-pending execution groups;
- each execution row/card must show approved Execution Plan revision, worker state, last event time, current step, PR/diff/test evidence when available, and continue/inspect action;
- raw runtime ids may be visible only as secondary metadata, not row titles.

#### Screenshot Acceptance

Implementation verification must capture screenshots at 375px, 768px, 1024px, and 1440px for Source Object Workspace, Development Plan Page, Development Plan Item Detail, Specs & Execution Plans Queue, and Executions. Review fails if screenshots show:

- incoherent overlap;
- horizontal page scroll;
- card-in-card composition;
- large empty primary surfaces without a next action;
- hidden role lens labels;
- action rail covering primary content;
- status communicated by color alone;
- raw runtime objects as the dominant page title.

### Color And Typography

Use a neutral light theme:

- background: off-white or very light slate;
- surface: white;
- borders: visible light slate;
- primary: trustworthy blue;
- success/readiness: green;
- attention/review: amber;
- blocker/destructive: red;
- text: high-contrast slate.

Typography:

- Inter or Plus Jakarta Sans;
- no viewport-scaled font sizes;
- no negative letter spacing;
- compact but readable table text;
- strong hierarchy for object title, section title, metadata, and row labels.

### Components

Use Tailwind-first implementation and shadcn/Radix-style primitives:

- Button;
- IconButton;
- Tabs;
- SegmentedControl;
- DataTable;
- StatusPill;
- MetadataGrid;
- ActionRail;
- Drawer;
- Dialog;
- Command palette;
- Toast;
- InlineNotice;
- Skeleton;
- EmptyState;
- MarkdownEditor;
- EvidenceAttachments.

Use lucide icons. No emoji icons.

### States

Every major surface must have explicit:

- loading state;
- empty state;
- error state;
- stale state;
- blocked state;
- approved state;
- running state;
- interrupted/resumable state.

Status must never be communicated by color alone.

## Frontend Architecture Requirements

- React Router Framework Mode remains the route architecture.
- Tailwind CSS remains the primary styling system.
- Radix/shadcn-style primitives remain the component model.
- TanStack Query remains server-state management.
- TanStack Table should be used for Development Plan tables and other table-like surfaces.
- React Hook Form plus Zod should be used for complex forms.
- MDXEditor must remain behind the ForgeLoop editor wrapper.
- Vanilla CSS should be limited to global tokens, third-party editor integration, and rare cases that Tailwind cannot express cleanly.

No legacy CSS system, old route shell, old debug workbench, or old/new UI switch may remain active.

## Data And API Contract Direction

Implementation planning must define concrete contracts for:

- Development Plan;
- Development Plan Item;
- Brainstorming Session;
- Boundary Summary;
- Spec revision linked to Development Plan Item;
- Execution Plan revision linked to Development Plan Item;
- Execution linked to approved Execution Plan revision;
- Code Review handoff;
- QA handoff;
- context manifest;
- role-lens queue projections.

Minimum conceptual relationship:

```text
SourceObject
  -> DevelopmentPlan
    -> DevelopmentPlanItem
      -> BrainstormingSession
      -> BoundarySummary
      -> SpecRevision
      -> ExecutionPlanRevision
      -> Execution
      -> CodeReviewHandoff
      -> QAHandoff
```

Execution must carry the approved Execution Plan revision id. Starting execution against missing, draft, stale, or unapproved Execution Plan revisions must fail closed.

Public DTOs, routes, queue rows, action payloads, links, and evidence projections must use typed refs:

- source object type/id/revision;
- Development Plan id/revision;
- Development Plan Item id/revision;
- BrainstormingSession id/revision;
- BoundarySummary id/revision;
- Spec revision id;
- Execution Plan revision id;
- Execution id;
- Code Review handoff id;
- QA handoff id.

Legacy `work_item` identifiers must be internal migration data only. They must be rejected or sanitized at public product boundaries and must not appear in public URLs, DTOs, queue rows, action payloads, or evidence projections.

## Route Direction

Exact route names can be finalized in the implementation plan, but the product shape should include:

- `/development-plans`;
- `/development-plans/new`;
- `/development-plans/:developmentPlanId`;
- `/development-plans/:developmentPlanId/items/:itemId`;
- `/development-plans/:developmentPlanId/items/:itemId/brainstorming`;
- `/development-plans/:developmentPlanId/items/:itemId/spec`;
- `/development-plans/:developmentPlanId/items/:itemId/execution-plan`;
- `/development-plans/:developmentPlanId/items/:itemId/execution`;
- `/executions`;
- `/executions/:executionId`.

Source object pages should link to their Development Plans rather than generate Spec/Plan directly.

Existing product `/tasks` routes and generic task backlog routes must be deleted, return product-safe 404/410, or move behind explicit Dev Tools-only routing. They must not remain reachable product surfaces and must not redirect to a compatibility backlog. Existing task-shaped data may only appear in Development Plan Item execution/evidence projections when it has a typed source object and approved Execution Plan linkage. Task-shaped records that cannot satisfy that linkage must be retired from the product surface or remain dev-only behind Dev Tools. Do not preserve a generic task backlog simply because it already exists.

## Migration / No-Baggage Rules

- Remove or replace product navigation that conflicts with this spec.
- Do not preserve old Work Item Owner labels.
- Do not add compatibility redirects from removed product routes.
- Do not keep a generic task backlog as a primary page if execution now runs from approved Execution Plan documents.
- Do not label Development Plan Item accountable actors as `Owner` in product UI or public DTOs. Use `Driver` for accountable human actors, `responsible_role` for lens routing, `reviewer_actor_id` for review gates, and `Release Owner` only for the existing Release Owner role.
- Do not expose legacy `work_item` public refs at product boundaries. Public DTOs, routes, queue rows, action payloads, links, and evidence projections must use typed refs. Legacy `work_item` ids are internal migration data only.
- Do not expose raw runtime object access in primary navigation; keep raw runtime objects dev-only or linked only from scoped evidence/report contexts.
- Do not expose raw Replay as primary navigation.
- Keep Dev Tools development-only.

## Verification Requirements For Implementation

Implementation plan must include:

- contract tests for Development Plan and Development Plan Item validation;
- contract tests for persisted BrainstormingSession and BoundarySummary minimum fields;
- negative tests proving direct source-object -> Spec/Plan generation is rejected;
- negative tests proving execution cannot start from draft/stale/unapproved Execution Plan revisions;
- negative tests proving public `work_item` refs are rejected or sanitized at public boundaries;
- route tests proving removed primary navigation is absent and direct product `/tasks` URLs do not resolve as product surfaces;
- accessibility tests for role lens controls, action rail commands, editor toolbar, and Development Plan table;
- Playwright smoke tests for key flows:
  - create/link Development Plan from Requirement;
  - manually create Development Plan row;
  - run boundary brainstorming mock flow;
  - generate/review Spec;
  - generate/review Execution Plan;
  - start/resume execution from approved Execution Plan;
  - code review to QA handoff;
- visual checks at 375px, 768px, 1024px, and 1440px;
- no horizontal scroll on supported viewports;
- no card-in-card layout;
- no color-only status;
- no emoji icons.

## Open Implementation Questions

These should be resolved in the implementation plan:

- Whether Development Plan Item detail launches first as a drawer plus deep link, or as a full page from day one.
- How much of the Codex runtime context manifest is available immediately versus stubbed in a degraded state.

## Acceptance Criteria

- The written implementation plan can produce a Web UI where a Requirement creates or links a Development Plan before any Spec/Plan generation.
- Development Plan is a table-like product object and supports manual authoring.
- AI assistance can generate or refine Development Plan content, but the product does not define Development Plan as always AI-generated.
- Each Development Plan row can enter boundary brainstorming before Spec generation.
- Spec generation and Execution Plan generation are gated by prior review states.
- Codex execution starts from approved Execution Plan documents, without requiring a structured executable task list in this slice.
- Role lenses change default emphasis without splitting shared objects.
- The UI design system is sufficiently concrete to prevent another sparse skeleton implementation.
- Legacy generic Work Item/Task-first navigation is not preserved as a primary product path.
