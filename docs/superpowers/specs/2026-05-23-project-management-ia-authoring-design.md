# Project Management IA And Authoring Redesign Design

## Status

User-approved design draft.

This spec defines a destructive product IA and authoring redesign for the Web app. It supersedes the current delivery-internal navigation shape and moves ForgeLoop toward a usable AI-native project management system.

The project is not launched. Implementation must favor the correct product architecture over migration comfort. Do not preserve legacy navigation, compatibility routes, old labels, or parallel old/new UI paths.

## Context

ForgeLoop now has productized delivery primitives: typed Work Item intake, Work Item detail, Specs and Plans, Execution Packages, Run Sessions, Review Packets, Release pages, ProductAction projections, runtime readiness, Tailwind-first UI primitives, and a cleaner route shell.

The current Web UI is visually cleaner than the previous internal console, but the information architecture still exposes too many implementation objects as primary product pages:

- Lanes are shown as a primary navigation model even though users think in project lifecycle objects.
- Packages, Runs, and Reviews are visible as top-level pages, which makes the app feel like a runtime object browser.
- Initiatives, Requirements, Tech Debt, Bugs, Tasks, Specs, Plans, QA, and Releases are not presented as a coherent project management loop.
- Initiative, Requirement, Spec, Plan, Task, Bug, and Tech Debt authoring still lacks a serious document editing model.
- Existing content input relies on plain fields and simple textareas rather than a product-grade Markdown authoring surface.

The PRD defines ForgeLoop as an AI-native research and delivery operating system, not as a raw agent workbench. The UI must reflect the PRD loop:

`Initiative / Requirement / Bug / Tech Debt -> Spec -> Plan -> Task -> Execution Package -> Run -> Review -> Test / Acceptance -> Release -> Observation`

Product users should primarily work with lifecycle objects they understand. Runtime artifacts remain available, but as evidence under the lifecycle objects they support.

## Goals

- Replace the current primary navigation with project-management-oriented product navigation.
- Make `My Work` the default role-aware inbox.
- Expose concrete product object families directly: Requirements, Specs and Plans, Tasks, Bugs, Board, Releases, and Reports.
- Include Initiative and Tech Debt as typed object surfaces even if they are grouped behind secondary navigation or filters in the first visual layout.
- Treat Task as a first-class developer-facing product object.
- Keep generic Work Item as a shared data/model abstraction, not a primary navigation label.
- Separate object visibility from edit responsibility.
- Make Spec and Plan visible to all relevant roles while making Tech Lead / Architect responsibility explicit.
- Move Execution Package, Run Session, Review Packet, and Trace data into evidence/execution layers rather than primary navigation.
- Introduce MDXEditor as the canonical WYSIWYG Markdown editor for narrative content.
- Introduce Evidence Attachments as first-class objects that support images, logs, recordings, and documents.
- Keep Markdown as the canonical persisted body for AI, diff, review, and version history.
- Preserve structured fields for status, priority, type, driver, risk, acceptance criteria, reproduction data, and object links.
- Define route, layout, data, authoring, attachment, and verification requirements for implementation planning.

## Non-Goals

- No Evolution Loop engine, retrospective automation, rule codification workflow, or learning-rule authoring in this slice. The IA must still preserve the PRD closure from Release to Observation, Replay, Retrospective, and Learning as visible evidence/report/observation surfaces under Releases, Reports, and object timelines.
- No real-time collaborative editing in the first implementation.
- No generic custom-field builder.
- No external Jira, Linear, GitHub Issues, or document-system sync.
- No mobile-native app.
- No public marketing site or landing page.
- No compatibility route family for the current lane-centered navigation.
- No primary navigation item for Execution Packages, Run Sessions, Review Packets, or raw traces.
- No base64 image storage inside Markdown bodies.
- No rich-text proprietary document format as the stored source of truth.
- No old/new UI switch, fallback shell, route alias, or compatibility adapter.

## Product Principles

### Concrete Objects In Navigation

Users should not need to understand internal abstractions before they can use the product.

Primary navigation must expose product objects:

- Dashboard
- My Work
- Requirements
- Specs & Plans
- Tasks
- Bugs
- Board
- Releases
- Reports

Do not use a generic Work Items primary navigation entry as the main way to browse the product. A global "All Work" or advanced search view may exist later, but it must not replace concrete object pages.

Initiatives and Tech Debt are concrete typed object routes, but they are not first-level sidebar entries in the first layout. They are reachable from `My Work`, `Requirements`, `Board`, `Reports`, and related object details. This keeps the primary navigation compact while preventing a generic Work Items fallback.

### Shared Visibility, Role-Specific Edit Responsibility

Most lifecycle objects are cross-role facts. Visibility and edit authority are separate concerns.

| Object | Default visibility | Primary editor / driver | Main purpose |
| --- | --- | --- | --- |
| Requirement | Product, Tech Lead, Dev, QA, Manager, Release Owner | Product / Requirement Driver | Define the user or stakeholder need, business context, scope, and acceptance target |
| Spec | Product, Tech Lead, Dev, QA, Manager | Tech Lead / Architect | Translate the requirement or bug into technical boundaries, risks, contracts, and design decisions |
| Plan | Product, Tech Lead, Dev, QA, Manager | Tech Lead / Implementation Lead | Translate the Spec into executable slices, sequencing, validation strategy, and Task generation |
| Task | Product, Tech Lead, Dev, QA, Manager | Developer / AI executor / Implementation Lead | Track concrete implementation work, PRs, execution status, and developer-facing acceptance |
| Bug | Product, Tech Lead, Dev, QA, Manager | Bug Driver / QA / Developer | Capture impact, reproduction, diagnosis, fix, regression, and replay |
| Release | Product, Tech Lead, Dev, QA, Manager, Release Owner | Release Owner | Aggregate readiness, risk, test evidence, rollout decision, and observation |

Role-specific defaults belong in `My Work`, saved views, filters, and permissions. They must not fragment core objects into isolated role pages.

### Task Is First-Class

Task is required for the complete product loop because Requirements and Bugs describe what should change, while Tasks describe what developers and AI executors do.

Rules:

- Task is a first-class product object and top-level navigation entry.
- Task usually has a parent Requirement, Bug, Tech Debt item, Initiative slice, or Plan section.
- Task may exist independently only for infrastructure, CI, local developer environment, migration, and operational work that is not release-scoped product behavior.
- Task owns developer-facing execution instructions, acceptance checklist, PR links, run links, review links, and status.
- One Task may link to one or more Execution Packages when AI/runtime execution is required; those packages are generated from approved Spec/Plan revision authority, not from Task authority alone.
- Execution Package is not a substitute for Task. Package is a runtime execution envelope and evidence object.

Task relationship and execution authority contract:

- A Task is a concrete developer-facing work object in the work graph, not a replacement authority for Requirement, Spec, Plan, or Execution Package.
- Parent-linked Tasks inherit the current approved SpecRevision and PlanRevision from their parent Requirement, Bug, Tech Debt item, Initiative slice, or Plan section.
- Package-generation eligibility requires an approved SpecRevision and approved PlanRevision. The generated Execution Package must carry those revision ids, and runtime enqueue must reject stale or missing revision authority.
- Independent Tasks can be tracked manually without a package when they are low-risk operational work. They still require structured acceptance evidence and a close reason.
- An independent Task that changes release-scoped product behavior, public contracts, security posture, data migration, runtime policy, or user-visible workflows must first be linked to or create a controlling Requirement, Bug, Tech Debt item, or Initiative slice and must pass Spec/Plan approval before package generation.
- Emergency/manual exception Tasks are allowed only as explicit audited exceptions with actor, reason, risk, rollback, verification evidence, and release impact. The exception may allow manual work tracking before normal Spec/Plan completion, but it must not authorize runtime package generation, runtime enqueue, release readiness, or any bypass of required review, test, acceptance, or observation gates.
- Task completion closes through acceptance evidence. Release-scoped Tasks contribute to Release readiness only when required review and Test/Acceptance evidence are present and passing.

### Internal Execution Objects Are Evidence

Execution Packages, Run Sessions, Review Packets, and traces are still important. They must not be hidden, but they should not dominate primary navigation.

They appear under:

- Task execution section.
- Plan execution breakdown.
- Requirement or Bug evidence timeline.
- Initiative or Tech Debt evidence timeline.
- Release readiness evidence.
- Reports and replay views.

The product question should be "what is the state of this Initiative, Requirement, Tech Debt item, Task, Bug, or Release?", not "which runtime object do I need to open?"

## Target Information Architecture

### Primary Navigation

Primary navigation:

1. `Dashboard`
2. `My Work`
3. `Requirements`
4. `Specs & Plans`
5. `Tasks`
6. `Bugs`
7. `Board`
8. `Releases`
9. `Reports`

Default route:

- `/my-work`

Authoritative active route table:

| Route | Purpose | Primary navigation? |
| --- | --- | --- |
| `/` | Redirects to `/my-work` only | No |
| `/dashboard` | System health overview | Yes |
| `/my-work` | Role-aware inbox and default landing page | Yes |
| `/requirements` | Requirement list and filters | Yes |
| `/requirements/new` | Requirement creation | No |
| `/requirements/:requirementId` | Requirement detail | No |
| `/requirements/:requirementId/spec` | Requirement-scoped Spec view | No |
| `/requirements/:requirementId/plan` | Requirement-scoped Plan view | No |
| `/requirements/:requirementId/evidence` | Requirement evidence timeline | No |
| `/initiatives` | Initiative list and milestone/scope filters | No |
| `/initiatives/new` | Initiative creation | No |
| `/initiatives/:initiativeId` | Initiative detail | No |
| `/initiatives/:initiativeId/evidence` | Initiative evidence timeline | No |
| `/tech-debt` | Tech Debt list and risk/module filters | No |
| `/tech-debt/new` | Tech Debt creation | No |
| `/tech-debt/:techDebtId` | Tech Debt detail | No |
| `/tech-debt/:techDebtId/evidence` | Tech Debt evidence timeline | No |
| `/specs-plans` | Spec and Plan queues | Yes |
| `/specs/:specId` | Spec detail and revisions | No |
| `/plans/:planId` | Plan detail and revisions | No |
| `/tasks` | Task list and filters | Yes |
| `/tasks/new` | Task creation | No |
| `/tasks/:taskId` | Task detail | No |
| `/tasks/:taskId/packages/:packageId` | Task-scoped package evidence | No |
| `/tasks/:taskId/runs/:runSessionId` | Task-scoped run evidence | No |
| `/tasks/:taskId/reviews/:reviewPacketId` | Task-scoped review evidence | No |
| `/bugs` | Bug list and filters | Yes |
| `/bugs/new` | Bug creation | No |
| `/bugs/:bugId` | Bug detail | No |
| `/bugs/:bugId/evidence` | Bug evidence timeline | No |
| `/board` | Cross-object board | Yes |
| `/releases` | Release list and filters | Yes |
| `/releases/:releaseId` | Release readiness and decision page | No |
| `/releases/:releaseId/evidence` | Release evidence and observation timeline | No |
| `/reports` | Report index | Yes |
| `/reports/delivery` | Delivery flow report | No |
| `/reports/quality` | Quality and bug escape report | No |
| `/reports/release-readiness` | Release readiness report | No |
| `/reports/observation` | Observation and post-release signal report | No |
| `/reports/replay` | Replay and retrospective evidence report | No |

Removed route families:

| Removed route family | Replacement | Rule |
| --- | --- | --- |
| `/lanes` and `/lanes/*` | `/my-work`, concrete object lists, saved filters | No redirect, alias, hidden fallback, or active navigation |
| `/pipeline` | `/dashboard`, `/board`, `/reports/delivery` | No top-level route compatibility |
| `/work-items` and `/work-items/*` | `/requirements`, `/initiatives`, `/tech-debt`, `/bugs`, `/tasks`, typed object details | No generic Work Items primary route |
| `/specs` exact list route | `/specs-plans` | No compatibility list route; `/specs/:specId` remains active |
| `/plans` exact list route | `/specs-plans` | No compatibility list route; `/plans/:planId` remains active |
| `/packages` and `/packages/*` | `/tasks/:taskId/packages/:packageId` evidence route | No primary route |
| `/runs` and `/runs/*` | `/tasks/:taskId/runs/:runSessionId` evidence route | No primary route |
| `/reviews` and `/reviews/*` | `/tasks/:taskId/reviews/:reviewPacketId` evidence route | No primary route |

Old route families must be inactive no-match routes in production product routing. They must not redirect, preserve query state, or render hidden compatibility pages. Tests must assert they do not appear in primary navigation and do not resolve as active product routes.

Task-scoped evidence route contract:

- `/tasks/:taskId/packages/:packageId` must verify that the package belongs to the Task identified by `taskId`.
- `/tasks/:taskId/runs/:runSessionId` must verify that the run belongs to a package linked to the Task identified by `taskId`.
- `/tasks/:taskId/reviews/:reviewPacketId` must verify that the review packet belongs to a package or review authority linked to the Task identified by `taskId`.
- A mismatched `taskId` and package/run/review id pair must render a product-safe not-found or access-denied state, not the evidence page.
- ProductAction targets, queue rows, readiness remediation routes, and read-model `href` fields must emit task-scoped evidence hrefs. They must not emit `/packages/:id`, `/runs/:id`, `/reviews/:id`, `/work-items/:id`, or `/work-items/:id/spec-plan`.

### `My Work`

`My Work` is a role-aware inbox over shared product objects. It is not an object type.

It should answer:

- What needs my attention now?
- Why is it assigned or relevant to me?
- What decision or edit is expected?
- What object will I affect if I act?

Default queue groups:

- Product attention: Requirements needing clarification, scope decisions, acceptance confirmation, release signoff.
- Tech Lead attention: Specs needing authoring or review, Plans needing approval, high-risk architecture gaps.
- Developer attention: Tasks ready for implementation, failed runs needing response, review changes, blocked tasks.
- QA attention: Bugs needing verification, test strategy gaps, release acceptance gates.
- Release Owner attention: Release risk decisions, rollout blockers, observation follow-up.
- Manager attention: roadmap slippage, cycle-time bottlenecks, high-risk work, blocked releases.

Rows must expose the concrete object type. Do not collapse Initiatives, Requirements, Tech Debt, Tasks, Bugs, Specs, Plans, and Releases into one generic item label.

### Dashboard

Dashboard is the system health overview, not the user inbox.

It should show:

- delivery throughput;
- blocked object counts;
- Requirements by phase;
- Tasks by execution state;
- Bugs by severity and regression status;
- release readiness;
- aging Spec/Plan queues;
- recent high-risk evidence;
- quality and review pressure.

### Requirements

Requirements is the shared business source of truth.

It should support:

- list and saved filters by phase, risk, driver, release, milestone, and blocked state;
- create flow with typed requirement intake;
- detail view with structured fields, Markdown body, Spec, Plan, Tasks, Bugs/Test, Release, and Evidence;
- product-owned editing for requirement fields and narrative sections;
- review and comment surfaces for Tech Lead, Dev, QA, and Manager.

### Initiatives

Initiatives is the business-outcome and cross-item planning surface.

It should support:

- list and saved filters by milestone, release intent, business outcome, driver, risk, and blocked state;
- create flow with typed initiative intake;
- detail view with structured fields, Markdown body, child Requirements/Bugs/Tech Debt, milestone intent, Release scope, and Evidence;
- product/manager-owned editing for initiative narrative and scope;
- cross-item coordination notes that remain structured enough to drive child object creation and reporting.

### Tech Debt

Tech Debt is a concrete typed work surface, not a generic Work Item fallback.

It should support:

- list and saved filters by affected module, risk, driver, migration state, validation strategy, and release impact;
- create flow with typed tech-debt intake;
- detail view with structured current pain, desired invariant, affected modules, behavior preservation requirements, validation strategy, Spec, Plan, Tasks, Release impact, and Evidence;
- Tech Lead / Architect editing responsibility for architectural intent;
- developer and QA visibility for migration work, behavior preservation, rollback, and validation.

### Specs & Plans

Specs and Plans are grouped in one primary navigation item to avoid a fragmented sidebar, but the page must separate Spec queues and Plan queues.

It should support:

- tabs or segmented control for Specs and Plans;
- "needs authoring", "needs review", "approved", "stale after requirement change", and "blocked" queues;
- Tech Lead / Architect editing ownership;
- Product, Dev, and QA read/comment access;
- requirement, bug, task, and release context links;
- diff between revisions;
- decision history;
- risk and contract sections.

### Tasks

Tasks is the developer-facing work management entry.

It should support:

- list filters by assignee/executor, parent object, status, repository, package/run state, review state, and release;
- task detail with execution instructions, acceptance checklist, PR/run/review links, blockers, and evidence;
- AI execution entry points when package/run readiness is satisfied;
- manual developer task tracking for work that does not require a runtime package;
- parent-child links to Requirement, Bug, Tech Debt, Initiative, Plan section, and Release.

### Bugs

Bugs is a concrete object page, not only a filter on Work Items.

It should support:

- structured bug intake: impact, observed behavior, expected behavior, reproduction steps, environment, severity, suspected area, verification path;
- screenshot, log, recording, and trace attachments;
- links to affected Initiative, Requirement, Tech Debt item, Task, Release, Run, Review, and Test evidence;
- simplified bug-fix path where appropriate, while still preserving Spec/Plan gates for high-risk changes;
- regression and replay status.

### Board

Board is a cross-object execution view.

It should support:

- columns by lifecycle state or custom saved view;
- cards for Requirements, Initiatives, Tech Debt, Tasks, Bugs, Specs, Plans, and Releases;
- filters by type, role, priority, risk, release, assignee, repo, and blocked reason;
- no hidden assumption that every card has the same schema.

### Releases

Releases aggregate multiple product objects and evidence.

They should show:

- release scope;
- readiness by Initiative, Requirement, Tech Debt, Task, Bug, and package evidence;
- test and acceptance gates;
- rollout decision;
- observation status;
- links to evidence and reports.

### Reports

Reports should focus on delivery and quality, not raw runtime exploration.

Initial report families:

- delivery flow and bottlenecks;
- quality and bug escape;
- release readiness and risk;
- review pressure and turnaround;
- requirement-to-release cycle time.

## Detail Page Composition

Each major object detail page should use a consistent structure:

1. Header with object title, type, lifecycle state, risk, driver/responsible actor labels appropriate to the type, and primary action.
2. Metadata strip with project, release, priority, repo, milestone, related objects, and freshness.
3. Main narrative/document area using MDXEditor where the object owns narrative content.
4. Structured sections for object-specific fields.
5. Lifecycle sections showing downstream/upstream objects.
6. Evidence and activity timeline.
7. Right action rail for safe next actions, blocked reasons, and decision forms.

Requirement detail order:

`Brief -> Spec -> Plan -> Tasks -> Bugs / Test -> Release -> Evidence`

Initiative detail order:

`Outcome -> Scope -> Child Requirements / Bugs / Tech Debt -> Milestones -> Release Intent -> Evidence`

Tech Debt detail order:

`Current Pain -> Desired Invariant -> Affected Modules -> Spec -> Plan -> Migration Tasks -> Validation -> Evidence`

Task detail order:

`Execution Brief -> Acceptance Checklist -> Parent Context -> Packages / Runs -> Reviews -> PRs -> Evidence`

Bug detail order:

`Impact -> Reproduction -> Diagnosis -> Fix Tasks -> Verification -> Regression Evidence -> Release Impact`

Spec/Plan detail order:

`Document -> Review State -> Source Object Context -> Task Breakdown -> Risks -> Decisions -> Evidence`

## Authoring UX

### Use MDXEditor

Use MDXEditor as the first implementation editor for narrative Markdown authoring.

Reasons:

- It is React-native and compatible with the current Web stack.
- It provides WYSIWYG Markdown editing while accepting and emitting Markdown strings.
- It keeps Markdown as the persisted canonical body.
- It avoids building a full Lexical toolbar and Markdown integration from scratch in this slice.

Implementation must introduce an editor wrapper owned by ForgeLoop, not scatter MDXEditor directly across pages. The wrapper defines toolbar policy, image insertion behavior, source mode, validation, autosave hooks, styling imports, and accessibility behavior.

Required wrapper contract:

```ts
type ForgeMarkdownEditorProps = {
  value: string;
  mode: 'edit' | 'read';
  objectRef: EditableObjectRef;
  allowedBlocks: readonly MarkdownBlockKind[];
  validationPolicy: MarkdownValidationPolicy;
  autosave?: AutosavePolicy;
  onChange: (nextMarkdown: string) => void;
  onSave?: (nextMarkdown: string) => Promise<void>;
  onUploadAttachment: (file: File, context: AttachmentUploadContext) => Promise<AttachmentRef>;
};
```

Canonical object reference contract:

```ts
type ObjectRef =
  | { type: 'initiative'; id: string }
  | { type: 'requirement'; id: string }
  | { type: 'bug'; id: string }
  | { type: 'tech_debt'; id: string }
  | { type: 'task'; id: string }
  | { type: 'spec'; id: string }
  | { type: 'spec_revision'; id: string; spec_id: string }
  | { type: 'plan'; id: string }
  | { type: 'plan_revision'; id: string; plan_id: string }
  | { type: 'execution_package'; id: string }
  | { type: 'run_session'; id: string }
  | { type: 'review_packet'; id: string }
  | { type: 'release'; id: string }
  | { type: 'attachment'; id: string };

type EditableObjectRef =
  | { type: 'initiative'; id: string; driver_actor_id?: string }
  | { type: 'requirement'; id: string; driver_actor_id?: string }
  | { type: 'bug'; id: string; driver_actor_id?: string }
  | { type: 'tech_debt'; id: string; driver_actor_id?: string }
  | { type: 'task'; id: string }
  | { type: 'spec'; id: string }
  | { type: 'plan'; id: string }
  | { type: 'release'; id: string };

type LegacyWorkItemStorageRef = {
  type: 'work_item';
  id: string;
  work_item_kind: 'initiative' | 'requirement' | 'bug' | 'tech_debt';
};
```

Rules:

- Public product read models use typed `ObjectRef`, not `work_item` refs, for Initiative, Requirement, Bug, and Tech Debt.
- `LegacyWorkItemStorageRef` may exist only behind repository/storage mapping while the database still stores typed Work Items in a shared table.
- API, Web, editor, attachment, readiness, and evidence DTOs must not expose `work_item` plus kind as the public shape when a typed `ObjectRef` is available.

Rules:

- The wrapper is controlled by Markdown string value, not by editor-private JSON state.
- MDXEditor package styles must be imported once by the wrapper or its owning feature boundary, not ad hoc per page.
- The wrapper must constrain output to ForgeLoop's allowed Markdown subset.
- MDX, JSX, raw HTML, script/style tags, iframe/embed/object tags, unsupported nodes, and unknown directives must be rejected or normalized before persistence.
- Source mode must use the same sanitizer and validator as WYSIWYG mode.
- Autosave writes drafts, not approved revisions. Lifecycle-changing saves remain explicit where review is required.
- Validation errors must identify whether the failure is markdown syntax, unsupported content, unsafe link/image, unresolved attachment reference, or object permission.
- Pages may configure templates and allowed blocks, but they may not bypass the wrapper's sanitization, attachment, source-mode, or autosave contract.

### Markdown Canonical Storage

Markdown is the stored and reviewed source of truth.

Rules:

- Store narrative body as Markdown.
- AI generation and summarization consume Markdown.
- Version history stores Markdown revisions.
- Diff mode compares Markdown revisions.
- WYSIWYG output must round-trip to Markdown without silently dropping supported content.
- Source mode is available for power users and debugging.
- Unsupported rich content must be rejected or normalized explicitly.

Markdown validation is a shared backend/API contract, not only a browser editor rule.

```ts
type MarkdownDocument = {
  markdown: string;
  object_ref: EditableObjectRef;
  allowed_blocks: readonly MarkdownBlockKind[];
  attachment_refs: readonly AttachmentRef[];
  validation_version: string;
};
```

Rules:

- `MarkdownDocument` and its validator live in shared contracts or an equivalent shared package consumed by both API and Web.
- Every narrative write endpoint must validate and normalize the MarkdownDocument before persistence.
- The editor wrapper may run the same validator for fast feedback, but frontend validation is not trusted as the enforcement boundary.
- The validator resolves every `attachment://` reference against object permissions and the Attachment API metadata before accepting the document.
- The validator rejects unresolved, unauthorized, archived, deleted, tombstoned, or wrong-scope attachment references unless the write is explicitly preserving a tombstone block.
- The validator rejects raw storage URLs in every Markdown link or image destination, not only images.

Allowed first-phase Markdown subset:

- paragraphs;
- headings h1-h4;
- bold, italic, strikethrough;
- ordered and unordered lists;
- task lists when the owning object treats them as narrative checklist, not workflow acceptance state;
- blockquote;
- fenced code block;
- inline code;
- links with safe protocols;
- tables;
- horizontal rule;
- images only through `attachment://` references.

Safe link destinations:

- same-origin product routes for ForgeLoop objects and evidence;
- `https://` external links after URL parsing and normalization;
- `mailto:` only where the product explicitly permits contact links;
- `attachment://<attachmentId>` for attachment references.

Disallowed persisted content:

- MDX JSX;
- raw HTML blocks or inline HTML;
- `data:`, `file:`, `blob:`, javascript-like, and raw storage URLs in any link or image destination;
- base64 images;
- embedded scripts, iframes, objects, and remote widgets.

### Structured Fields Stay Structured

Do not push product data into Markdown when it needs validation, filtering, workflow, or reporting.

Structured fields include:

- object type;
- lifecycle state;
- driver or primary responsible actor;
- priority;
- risk;
- release;
- project/stream;
- acceptance criteria;
- in-scope and out-of-scope lists;
- reproduction steps;
- expected and observed behavior;
- affected environment;
- verification path;
- task acceptance checklist;
- parent/child object links;
- package/run/review/release links.

The editor holds narrative context, reasoning, decisions, explanations, and embedded evidence references.

### Editor Capabilities

Required first implementation capabilities:

- WYSIWYG Markdown editing.
- Markdown source toggle.
- read-only mode for users without edit rights.
- object-type templates.
- toolbar for headings, bold, italic, lists, links, tables, code block, quote, image insert, and divider.
- paste and drag/drop image upload.
- attachment picker.
- inline image rendering from attachment references.
- autosave draft state.
- explicit save/publish where object lifecycle requires review.
- revision history.
- Markdown diff between versions.
- validation errors connected to the relevant section.
- unsaved-change guard.
- keyboard accessible toolbar and focus states.

Image and file insertion is mandatory and safe by construction:

- toolbar image insert uploads the file through the Attachment API before inserting Markdown;
- paste image uploads through the Attachment API before inserting Markdown;
- drag/drop image uploads through the Attachment API before inserting Markdown;
- source mode validation rejects `data:`, `file:`, `blob:`, base64, and raw public storage image URLs;
- non-image file insertion creates an Attachment record and may insert a link-style attachment reference;
- failed upload leaves no broken inline Markdown reference;
- broken, unauthorized, archived, deleted, or tombstoned attachment references render as explicit unavailable evidence blocks with no raw URI leakage.

Deferred:

- real-time multiplayer cursors;
- operational transform / CRDT;
- full document comments anchored to arbitrary Markdown ranges;
- nested page database blocks;
- diagram editor;
- office document import.

### Object-Specific Authoring

Requirement authoring:

- structured intake fields;
- Markdown body for background, user context, examples, and discussion;
- acceptance criteria remain structured and can also render into the document preview;
- images for screenshots, flows, product references, and diagrams.

Spec authoring:

- Markdown sections for architecture, contracts, data model, risks, non-goals, alternatives, and rollout notes;
- Tech Lead / Architect edit authority;
- Product, Dev, QA comment/review visibility;
- diagrams and screenshots as attachments;
- revision approval and stale-state detection when upstream Requirement changes.

Plan authoring:

- Markdown sections for sequencing, validation strategy, rollout, and risk;
- structured Task breakdown section separate from narrative Markdown;
- task generation from Plan sections must create Task objects, not hide tasks inside prose.

Task authoring:

- lighter editor for execution instructions and context;
- structured acceptance checklist;
- PR/run/review links;
- task status and blockers outside Markdown.

Bug authoring:

- structured reproduction fields;
- Markdown diagnosis notes;
- screenshots, logs, recordings, and traces as evidence attachments;
- verification and regression path structured for QA.

## Evidence Attachments

### First-Class Attachment Model

Attachments are first-class evidence objects, not only editor uploads.

Supported attachment categories:

- image: screenshots, diagrams, product references;
- log/text: CI output, runtime logs, stack traces, run summaries;
- video/recording: reproduction recordings and interaction bugs;
- document/PDF: external materials, review docs, reference specs;
- generated artifact: AI output, execution summary, review summary, release evidence.

Internal attachment records must include:

- id;
- owning object id and owning object type;
- optional linked object ids;
- filename;
- content type;
- size;
- storage URI;
- checksum or integrity field where available;
- uploader actor;
- created timestamp;
- evidence category;
- caption / alt text where applicable;
- visibility / permission scope;
- scan/safety status if file scanning exists.

Internal storage fields such as `storage_uri` must stay server-side. Public read models, editor DTOs, readiness DTOs, and browser-rendered attributes must use `AttachmentRef` plus `AttachmentRenderRef`, never raw storage locations.

### Markdown References

Markdown bodies may embed attachments by stable references:

```md
![Checkout failure screenshot](attachment://att_123)
```

Rules:

- Do not embed base64 content in Markdown.
- Do not store public raw storage URLs as the canonical Markdown reference.
- Resolve `attachment://` references through the API/client.
- Broken or unauthorized references render as explicit unavailable evidence blocks.
- Attachment deletion must either be blocked while referenced or leave a clear tombstone.

### Attachment API Scope

The first implementation must provide a concrete attachment API contract.

Endpoint contract:

| Endpoint | Purpose | Notes |
| --- | --- | --- |
| `POST /api/attachments` | Upload and create an Attachment record | Multipart upload only; no base64 request body |
| `GET /api/attachments?object_type=&object_id=` | List attachments for an object | Enforces object read permission |
| `GET /api/attachments/:attachmentId` | Fetch metadata | Enforces attachment read permission |
| `POST /api/attachments/:attachmentId/render-url` | Create a short-lived safe render/download URL | Returns URL plus expiry; never becomes canonical Markdown |
| `PATCH /api/attachments/:attachmentId` | Update caption, alt text, category, and visibility metadata | Does not replace binary content |
| `POST /api/attachments/:attachmentId/links` | Link attachment to another object as reused evidence | Enforces read on source and write on target |
| `DELETE /api/attachments/:attachmentId` | Archive or delete under reference-safety rules | Must not silently break active Markdown references |

Upload transport:

- `POST /api/attachments` is `multipart/form-data`.
- The binary part is named `file`.
- The metadata part is named `metadata` and must parse as `AttachmentUploadMetadata`.
- JSON, base64, raw URL, and data-URI upload bodies are rejected.

```ts
type AttachmentUploadMetadata = {
  object_type: 'initiative' | 'requirement' | 'tech_debt' | 'spec' | 'plan' | 'task' | 'bug' | 'release';
  object_id: string;
  evidence_category: 'image' | 'log' | 'recording' | 'document' | 'generated_artifact';
  caption?: string;
  alt_text?: string;
  visibility?: 'object' | 'release' | 'project';
};
```

Internal storage model:

```ts
type AttachmentRecord = {
  id: string;
  owner_object_type: 'initiative' | 'requirement' | 'tech_debt' | 'spec' | 'plan' | 'task' | 'bug' | 'release';
  owner_object_id: string;
  linked_object_refs: readonly ObjectRef[];
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_uri: string;
  checksum_sha256: string;
  uploaded_by_actor_id: string;
  created_at: string;
  evidence_category: 'image' | 'log' | 'recording' | 'document' | 'generated_artifact';
  caption?: string;
  alt_text?: string;
  visibility: 'object' | 'release' | 'project';
  safety_status: 'pending' | 'passed' | 'blocked' | 'unavailable';
  reference_status: 'active' | 'archived' | 'tombstoned';
};
```

Public attachment read model:

```ts
type AttachmentRef = {
  id: string;
  owner_object_type: 'initiative' | 'requirement' | 'tech_debt' | 'spec' | 'plan' | 'task' | 'bug' | 'release';
  owner_object_id: string;
  linked_object_refs: readonly ObjectRef[];
  filename: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  uploaded_by_actor_id: string;
  created_at: string;
  evidence_category: 'image' | 'log' | 'recording' | 'document' | 'generated_artifact';
  caption?: string;
  alt_text?: string;
  visibility: 'object' | 'release' | 'project';
  safety_status: 'pending' | 'passed' | 'blocked' | 'unavailable';
  reference_status: 'active' | 'archived' | 'tombstoned';
};

type AttachmentRenderRef = {
  attachment_id: string;
  render_url: string;
  expires_at: string;
  content_type: string;
  disposition: 'inline' | 'download';
};
```

Frontend integration files:

| File / module | Required responsibility |
| --- | --- |
| `apps/web/src/shared/ui/markdown-editor/markdown-editor.tsx` | ForgeMarkdownEditor wrapper around MDXEditor, source mode, toolbar, validation display, read-only rendering |
| `apps/web/src/shared/ui/markdown-editor/markdown-policy.ts` | allowed block policy, safe protocol policy, MarkdownDocument client validation bridge |
| `apps/web/src/shared/ui/markdown-editor/attachment-plugin.ts` | paste/drop/toolbar image handling that uploads first and inserts only `attachment://` references |
| `apps/web/src/shared/ui/markdown-editor/index.ts` | public exports |
| `apps/web/src/shared/api/attachments.ts` | multipart FormData upload, list, metadata, link, patch, delete/archive, and safe render-url calls |
| `apps/web/src/shared/api/common.ts` | add a non-JSON request path or raw fetch helper for multipart uploads without setting `content-type: application/json` |
| `apps/web/src/shared/api/query-keys.ts` | add typed attachment/render-url/editor document query keys without reusing old package/run/review registry keys |
| `apps/web/src/shared/api/types.ts` | export AttachmentRef, AttachmentRenderRef, MarkdownDocument, ObjectRef, and EditableObjectRef from contracts |

Frontend tests:

| Test file | Required coverage |
| --- | --- |
| `tests/web/markdown-editor.test.tsx` | WYSIWYG/source round trip, read-only mode, allowed Markdown subset, unsupported MDX/HTML rejection |
| `tests/web/markdown-editor-attachments.test.tsx` | paste/drop/toolbar image upload, `attachment://` insertion, failed upload rollback, tombstone rendering |
| `tests/web/attachment-api.test.ts` | multipart upload request, render-url resolution, no JSON/base64 upload body, no raw storage URL exposure |
| `tests/web/attachment-evidence-rendering.test.tsx` | safe render refs, unavailable evidence states, permission/tombstone UI |

Validation and permission rules:

- Upload accepts only allowlisted content types and size limits per category.
- Upload computes and stores a checksum before returning success.
- Upload rejects empty files, mismatched content type, unsupported extension/content pairs, and oversized files.
- Object write permission is required to upload against an object.
- Object read permission is required to list or resolve attachments.
- Linking reused evidence requires read permission on the attachment and write permission on the target object.
- Safe render/download URLs are short-lived and permission checked at creation time.
- `AttachmentRenderRef.render_url` must be an opaque same-origin API/proxy URL such as `/api/attachments/{id}/render/{token}`.
- `AttachmentRenderRef.render_url` must not expose object-store hostnames, bucket names, storage keys, signed query parameters, private origins, or `storage_uri` fragments.
- `storage_uri` is internal and must not appear in Markdown, public read models intended for the editor body, or browser-visible href/src attributes.
- Upload/list/metadata/editor/readiness DTOs must return `AttachmentRef`, not `AttachmentRecord`.
- The browser may render or download binary content only with `AttachmentRenderRef` from the safe render-url endpoint.
- Delete archives the attachment if it is referenced by Markdown, release readiness, review, test/acceptance, or trace evidence. Hard delete is allowed only when no active reference exists.
- Archived or tombstoned attachments render as unavailable evidence blocks, not as broken images or raw URLs.

Image upload must be integrated into the editor wrapper. Non-image attachments can be added from the Evidence panel and referenced from Markdown through the attachment picker.

## Data Model Implications

### Shared Shell, Typed Surfaces

The backend may keep a shared Work Item shell, but product routes and read models should expose typed surfaces.

Minimum typed object surfaces:

- Requirement
- Bug
- Tech Debt item
- Initiative
- Task

Task may share infrastructure with Work Item or be a separate table/object, but the public product contract must make Task first-class. The implementation plan must decide the concrete storage shape after code inspection.

Required Task authority fields:

```ts
type TaskDetail = {
  id: string;
  parent_ref?: ObjectRef;
  controlling_spec_revision_id?: string;
  controlling_plan_revision_id?: string;
  stale_state: 'current' | 'stale_spec' | 'stale_plan' | 'stale_parent' | 'manual_exception';
  audited_exception?: {
    exception_id: string;
    actor_id: string;
    reason: string;
    risk: 'low' | 'medium' | 'high' | 'critical';
    rollback_plan: string;
    verification_ref: TestAcceptanceEvidenceRef | { type: 'audited_exception_decision'; id: string };
    supporting_attachment_refs: readonly AttachmentRef[];
    release_impact: 'none' | 'release_scoped';
    created_at: string;
  };
};
```

Rules:

- Runtime package generation from a Task always requires current approved `controlling_spec_revision_id` and `controlling_plan_revision_id`.
- `manual_exception` does not authorize runtime package generation, runtime enqueue, or release readiness. It only records an audited reason for manual work tracking while normal Spec/Plan authority is incomplete.
- Attachments may support an audited exception, but a bare `AttachmentRef` never satisfies the verification authority for an exception or gate.
- Tasks with `stale_spec`, `stale_plan`, or `stale_parent` cannot generate or enqueue runtime packages.

Required relationships:

- Initiative links to child Requirements, Bugs, Tech Debt items, milestone/release intent, cross-item coordination notes, and Evidence.
- Requirement links to current Spec, current Plan, derived Tasks, related Bugs, Release scope, and Evidence.
- Bug links to current Spec and Plan when risk requires them, fix Tasks, affected Requirements, Release impact, and Evidence.
- Tech Debt item links to current Spec, current Plan, affected modules, migration Tasks, behavior-preservation evidence, Release impact, and Evidence.
- Plan defines the executable Task breakdown and preserves the SpecRevision/PlanRevision authority that generated each Task.
- Task links to Execution Packages, Runs, Review Packets, PR links, and Evidence, but package/run authority always comes from current approved Spec/Plan revisions.
- Release aggregates Initiatives, Requirements, Tech Debt items, Tasks, Bugs, scoped package/run evidence, review evidence, Test/Acceptance evidence, rollout decisions, and observation evidence.

### Read Models

Create page-specific read models instead of forcing every page to assemble raw objects client-side.

Required read models:

- `MyWorkQueueItem`
- `InitiativeListItem`
- `InitiativeDetail`
- `RequirementListItem`
- `RequirementDetail`
- `SpecPlanQueueItem`
- `SpecDetail`
- `PlanDetail`
- `TechDebtListItem`
- `TechDebtDetail`
- `TaskListItem`
- `TaskDetail`
- `BugListItem`
- `BugDetail`
- `BoardCard`
- `ReleaseReadinessDetail`
- `AttachmentRef`
- `AttachmentRenderRef`

Product read models must hide runtime-internal details unless the page is explicitly showing evidence.

### Review, Test, Acceptance, And Release Readiness Closure

The IA redesign must keep the PRD delivery closure testable. Moving runtime objects into evidence sections must not weaken review, test, acceptance, or release gates.

Required closure model:

- Review evidence authority is typed. Freeform notes, comments, Markdown text, or generic attachments do not satisfy a review gate unless they are linked through a `ReviewEvidenceRef` with an approved authority type.
- AI self-review is supplemental evidence only. It cannot satisfy a required review gate by itself.
- Test evidence comes from structured Test/Acceptance records, not only Markdown notes.
- Release readiness aggregates required review, test, acceptance, package/run, and observation evidence by scope.
- Missing, failed, stale, unauthorized, or tombstoned evidence blocks readiness with a product-safe disabled reason.
- Passing evidence unblocks readiness only when it belongs to the same relevant Initiative/Requirement/Tech Debt/Bug/Task/Package/Release scope and current Spec/Plan revision where applicable.

Minimum read-model fields:

```ts
type ReviewEvidenceRef = {
  id: string;
  authority_type: 'review_packet_approval' | 'human_review_decision';
  authority_ref: { type: 'review_packet'; id: string } | { type: 'human_review_decision'; id: string };
  scope_ref: ObjectRef;
  status: 'missing' | 'pending' | 'approved' | 'changes_requested' | 'rejected' | 'stale' | 'blocked';
  required: boolean;
  reviewer_actor_id?: string;
  review_packet_id?: string;
  decision_id?: string;
  execution_package_id?: string;
  spec_revision_id?: string;
  plan_revision_id?: string;
  approved_at?: string;
  stale_reason?: string;
  attachment_refs: readonly AttachmentRef[];
};

type TestAcceptanceEvidenceRef = {
  id: string;
  scope_ref: ObjectRef;
  evidence_type: 'test_result' | 'qa_acceptance' | 'product_acceptance' | 'regression' | 'integration_validation';
  status: 'missing' | 'pending' | 'passed' | 'failed' | 'stale' | 'blocked';
  required: boolean;
  actor_id?: string;
  attachment_refs: readonly AttachmentRef[];
  run_session_id?: string;
  review_packet_id?: string;
  created_at?: string;
  completed_at?: string;
  stale_reason?: string;
};

type EvidenceRequirementStatus = {
  requirement_id: string;
  scope_ref: ObjectRef;
  kind:
    | 'review'
    | 'qa_acceptance'
    | 'product_acceptance'
    | 'regression'
    | 'integration_validation'
    | 'package_run'
    | 'observation';
  status: 'missing' | 'pending' | 'passed' | 'failed' | 'stale' | 'blocked' | 'unauthorized' | 'tombstoned';
  current_spec_revision_id?: string;
  evidence_spec_revision_id?: string;
  current_plan_revision_id?: string;
  evidence_plan_revision_id?: string;
  evidence_ref?: ReviewEvidenceRef | TestAcceptanceEvidenceRef;
  supporting_attachment_refs?: readonly AttachmentRef[];
  disabled_reason?: ProductSafeDisabledReason;
};

type ProductSafeDisabledReason = {
  code:
    | 'missing_required_review'
    | 'review_not_approved'
    | 'missing_required_test_acceptance'
    | 'test_acceptance_failed'
    | 'evidence_stale'
    | 'evidence_scope_mismatch'
    | 'evidence_revision_mismatch'
    | 'evidence_unauthorized'
    | 'evidence_tombstoned'
    | 'missing_package_run_evidence'
    | 'missing_observation_evidence';
  message: string;
  target_ref?: ObjectRef;
  remediation_route?: string;
};

type ReleaseReadinessDetail = {
  release_id: string;
  scope_refs: readonly ObjectRef[];
  required_review_evidence: readonly EvidenceRequirementStatus[];
  required_test_acceptance_evidence: readonly EvidenceRequirementStatus[];
  package_run_evidence: readonly EvidenceRequirementStatus[];
  observation_evidence: readonly EvidenceRequirementStatus[];
  ready: boolean;
  disabled_reasons: readonly ProductSafeDisabledReason[];
};
```

Verification must prove release readiness:

- blocks when required review evidence is missing;
- blocks when review evidence is freeform, untyped, not approved, stale, or scoped to the wrong object;
- blocks when only AI self-review or unattached Attachment evidence exists without typed ReviewEvidenceRef or TestAcceptanceEvidenceRef authority;
- blocks when required Test/Acceptance evidence is missing, failed, stale, unauthorized, or tombstoned;
- blocks when evidence belongs to the wrong object scope or stale Spec/Plan revision;
- unblocks when all required review and Test/Acceptance evidence is present, passing, authorized, and scoped correctly.

## Frontend Architecture Implications

Use the existing React Router / Vite / Tailwind / shared primitive architecture, but replace the product IA destructively.

Required frontend areas:

- Initiatives routes;
- app shell navigation update;
- `My Work` route and role-aware queue composition;
- Requirements routes;
- Specs & Plans route;
- Tech Debt routes;
- Tasks routes;
- Bugs routes;
- Board route;
- Release route adjustments;
- Reports route;
- shared `MarkdownEditor` wrapper around MDXEditor;
- shared `EvidenceAttachments` components;
- typed object page layout primitives;
- route-level loading/error/empty states.

Do not route primary users into Dev Tools, raw ids, raw JSON, or runtime object pages to complete the main loop.

## Visual Direction

The Tailwind-first visual system from the UI cleanliness work remains the base.

The redesigned pages should feel:

- calm;
- clean;
- information-dense;
- scan-friendly;
- role-aware without being role-siloed;
- operational rather than decorative.

Layout rules:

- left navigation uses concrete product object names;
- detail pages use a wide content column plus a right action/evidence rail where helpful;
- editors get enough width for serious reading and writing;
- metadata should be compact and structured;
- tables and boards must have mobile fallbacks;
- no card-in-card composition;
- no giant marketing hero sections;
- no decorative gradient/orb background.

## Migration And No-Baggage Rules

Implementation must be destructive, not additive.

Required removals or replacements:

- Replace lane-centered primary navigation with the target navigation.
- Remove Packages, Runs, and Reviews as primary navigation entries.
- Remove `/lanes`, `/pipeline`, `/work-items`, `/packages`, `/runs`, and `/reviews` route families from active product routing.
- Replace route tests, fixtures, navigation snapshots, and labels that assert the old primary route families.
- Remove or replace components whose only purpose is rendering the old lane-centered or runtime-object-browser primary pages.
- Replace old page labels and object browser flows with lifecycle object flows.
- Move runtime object links into evidence sections.
- Replace primary textareas for narrative object bodies with the shared MDXEditor wrapper.
- Introduce Attachment API and Evidence Attachments rather than local editor-only image handling.
- Preserve typed intake data on public product surfaces through `driver_actor_id` and discriminated `intake_context` for Requirement, Bug, Tech Debt, and Initiative. Do not collapse them into generic Work Item fields.

Driver and typed-intake no-baggage rules:

- Product-facing typed object create/update/read contracts use `driver_actor_id`, not generic Work Item owner fields.
- Typed object surfaces preserve discriminated `intake_context` and expose type-specific fields instead of rendering only normalized goal text.
- Product UI labels use Requirement Driver, Bug Driver, Tech Debt Driver, and Initiative Driver where a Work Item type needs a responsible driver.
- Generic `Work Item Owner`, `work-item-owner`, and public Work Item `owner_actor_id` are forbidden on active product-facing routes, DTOs, query keys, fixtures, happy-path tests, and UI copy.
- Legitimate non-Work-Item role names remain allowed: Project Owner, Execution Owner, QA/Test Owner, Release Owner, and package/review ownership fields where they refer to execution/review/release responsibilities rather than Work Item typed surfaces.

Exact Web route-module cleanup:

| Current file | Final action |
| --- | --- |
| `apps/web/src/app/routes.ts` | Replace route config with the final route map below; no old-family entries remain |
| `apps/web/src/app/routes/lanes/index.tsx` | Delete; replace with `/my-work` and typed object list routes |
| `apps/web/src/app/routes/lanes/$laneId.tsx` | Delete; saved filters live under `/my-work`, typed object lists, or `/board` |
| `apps/web/src/app/routes/pipeline/index.tsx` | Delete; replace with `/dashboard`, `/board`, and `/reports/delivery` |
| `apps/web/src/app/routes/work-items/index.tsx` | Delete; replace with `/requirements`, `/initiatives`, `/tech-debt`, `/bugs`, and `/tasks` |
| `apps/web/src/app/routes/work-items/new.tsx` | Delete; replace with typed `/requirements/new`, `/initiatives/new`, `/tech-debt/new`, `/bugs/new`, and `/tasks/new` |
| `apps/web/src/app/routes/work-items/$workItemId.tsx` | Delete or refactor into typed detail routes; no generic `/work-items/:id` route remains |
| `apps/web/src/app/routes/work-items/$workItemId/spec-plan.tsx` | Delete or refactor into typed Requirement-scoped Spec/Plan routes; no `/work-items/:id/spec-plan` route remains |
| `apps/web/src/app/routes/packages/index.tsx` | Delete; package registry becomes evidence under Tasks/Plans/Releases |
| `apps/web/src/app/routes/packages/$packageId.tsx` | Delete or refactor into `/tasks/:taskId/packages/:packageId` |
| `apps/web/src/app/routes/runs/index.tsx` | Delete; run registry is not a product page |
| `apps/web/src/app/routes/runs/$runSessionId.tsx` | Delete or refactor into `/tasks/:taskId/runs/:runSessionId` |
| `apps/web/src/app/routes/reviews/index.tsx` | Delete; review registry is not a product page |
| `apps/web/src/app/routes/reviews/$reviewPacketId.tsx` | Delete or refactor into `/tasks/:taskId/reviews/:reviewPacketId` |
| `apps/web/src/app/routes/specs/index.tsx` | Replace with `/specs-plans` queue entry or delete if not needed |
| `apps/web/src/app/routes/plans/index.tsx` | Replace with `/specs-plans` queue entry or delete if not needed |
| `apps/web/src/app/routes/_index.tsx` | Add root route module that only redirects `/` to `/my-work`; it must not render a second My Work page copy |

Final `apps/web/src/app/routes.ts` route map:

```ts
export default [
  layout('./routes/_layout.tsx', [
    index('./routes/_index.tsx'),
    route('dashboard', './routes/dashboard/index.tsx'),
    route('my-work', './routes/my-work/index.tsx'),
    ...prefix('initiatives', [
      index('./routes/initiatives/index.tsx'),
      route('new', './routes/initiatives/new.tsx'),
      route(':initiativeId', './routes/initiatives/$initiativeId.tsx'),
      route(':initiativeId/evidence', './routes/initiatives/$initiativeId/evidence.tsx'),
    ]),
    ...prefix('requirements', [
      index('./routes/requirements/index.tsx'),
      route('new', './routes/requirements/new.tsx'),
      route(':requirementId', './routes/requirements/$requirementId.tsx'),
      route(':requirementId/spec', './routes/requirements/$requirementId/spec.tsx'),
      route(':requirementId/plan', './routes/requirements/$requirementId/plan.tsx'),
      route(':requirementId/evidence', './routes/requirements/$requirementId/evidence.tsx'),
    ]),
    ...prefix('tech-debt', [
      index('./routes/tech-debt/index.tsx'),
      route('new', './routes/tech-debt/new.tsx'),
      route(':techDebtId', './routes/tech-debt/$techDebtId.tsx'),
      route(':techDebtId/evidence', './routes/tech-debt/$techDebtId/evidence.tsx'),
    ]),
    route('specs-plans', './routes/specs-plans/index.tsx'),
    route('specs/:specId', './routes/specs/$specId.tsx'),
    route('specs/:specId/revisions/:revisionId', './routes/specs/$specId/revisions/$revisionId.tsx'),
    route('plans/:planId', './routes/plans/$planId.tsx'),
    route('plans/:planId/revisions/:revisionId', './routes/plans/$planId/revisions/$revisionId.tsx'),
    ...prefix('tasks', [
      index('./routes/tasks/index.tsx'),
      route('new', './routes/tasks/new.tsx'),
      route(':taskId', './routes/tasks/$taskId.tsx'),
      route(':taskId/packages/:packageId', './routes/tasks/$taskId/packages/$packageId.tsx'),
      route(':taskId/runs/:runSessionId', './routes/tasks/$taskId/runs/$runSessionId.tsx'),
      route(':taskId/reviews/:reviewPacketId', './routes/tasks/$taskId/reviews/$reviewPacketId.tsx'),
    ]),
    ...prefix('bugs', [
      index('./routes/bugs/index.tsx'),
      route('new', './routes/bugs/new.tsx'),
      route(':bugId', './routes/bugs/$bugId.tsx'),
      route(':bugId/evidence', './routes/bugs/$bugId/evidence.tsx'),
    ]),
    route('board', './routes/board/index.tsx'),
    ...prefix('releases', [
      index('./routes/releases/index.tsx'),
      route(':releaseId', './routes/releases/$releaseId.tsx'),
      route(':releaseId/evidence', './routes/releases/$releaseId/evidence.tsx'),
    ]),
    route('reports', './routes/reports/index.tsx'),
    route('reports/delivery', './routes/reports/delivery.tsx'),
    route('reports/quality', './routes/reports/quality.tsx'),
    route('reports/release-readiness', './routes/reports/release-readiness.tsx'),
    route('reports/observation', './routes/reports/observation.tsx'),
    route('reports/replay', './routes/reports/replay.tsx'),
    route('dev-tools', './routes/dev-tools/index.tsx'),
  ]),
] satisfies RouteConfig;
```

The final route config must not include `prefix('lanes')`, `route('pipeline')`, `prefix('work-items')`, `prefix('packages')`, `prefix('runs')`, `prefix('reviews')`, `prefix('specs', [index(...)])`, or `prefix('plans', [index(...)])`.

Exact feature cleanup:

| Current feature file or folder | Final action |
| --- | --- |
| `apps/web/src/features/product-lanes/product-lane-route.tsx` | Delete or refactor into `my-work` queue composition; no lane route component remains |
| `apps/web/src/features/product-lanes/product-lane-table.tsx` | Refactor only if it becomes a generic queue/table primitive with no lane vocabulary |
| `apps/web/src/features/product-lanes/product-lane-view-model.ts` | Replace with `MyWorkQueueItem` and typed list read models |
| `apps/web/src/features/product-lanes/product-lanes.ts` | Delete or replace with saved-view constants that do not define lane navigation |
| `apps/web/src/features/pipeline/pipeline-route.tsx` | Delete or refactor into dashboard/board/report components |
| `apps/web/src/features/work-items/work-items-list.tsx` | Replace with typed Requirement/Initiative/Tech Debt/Bug/Task list components |
| `apps/web/src/features/work-items/work-item-detail.tsx` | Replace with typed Requirement/Initiative/Tech Debt/Bug/Task detail components |
| `apps/web/src/features/work-items/create-work-item-form.tsx` | Replace with typed Requirement/Initiative/Tech Debt/Bug/Task create flows |
| `apps/web/src/features/work-items/delivery-cockpit/*` | Refactor into typed detail sections and evidence sections; no generic Delivery Cockpit route remains |
| `apps/web/src/features/execution-packages/execution-package-routes.tsx` | Delete or refactor into task-scoped package evidence components |
| `apps/web/src/features/run-console/run-console-routes.tsx` | Delete or refactor into task-scoped run evidence components |
| `apps/web/src/features/review-packets/review-packet-routes.tsx` | Delete or refactor into task-scoped review evidence components |
| `apps/web/src/features/review-packets/review-decision-form.tsx` | Keep only as a task/release evidence decision form, not as a review registry page |
| `apps/web/src/features/spec-plan/spec-plan-work-item-flow.tsx` | Delete or refactor into Requirement/Initiative/Tech Debt/Bug scoped Spec/Plan flow components; no generic Work Item spec-plan flow remains |
| `apps/web/src/shared/layout/sidebar-nav/sidebar-nav.tsx` | Update expected nav items to the target primary navigation and remove old route entries |
| `apps/web/src/shared/layout/app-shell/app-shell.tsx` | Update default route and nav model; no old route-family highlighting |

Exact Web test and fixture cleanup:

| Current test / fixture | Final action |
| --- | --- |
| `tests/web/app-shell-routing.test.tsx` | Replace expected routes/nav with target IA and root redirect to `/my-work` |
| `tests/web/router-test-utils.tsx` | Replace imported route modules and test route tree with the final route map; removed route modules must not be imported |
| `tests/web/product-lanes-route.test.tsx` | Delete or replace with `my-work` queue tests |
| `tests/web/pipeline-product-route.test.tsx` | Delete or replace with dashboard/board/report tests |
| `tests/web/work-item-product-route.test.tsx` | Delete or replace with typed Requirement/Initiative/Tech Debt/Bug/Task detail route tests |
| `tests/web/work-item-intake-form.test.tsx` | Replace generic Work Item create assertions with typed object create assertions for Requirement, Initiative, Tech Debt, Bug, and Task |
| `tests/web/work-item-delivery-cockpit.test.tsx` | Refactor into typed detail and evidence tests |
| `tests/web/package-run-product-routes.test.tsx` | Replace top-level package/run route assertions with task-scoped evidence route assertions |
| `tests/web/review-release-product-routes.test.tsx` | Replace review route assertions with task-scoped review evidence; keep release route assertions only under `/releases` |
| `tests/web/spec-plan-direct-routes.test.tsx` | Update list-entry assertions to `/specs-plans`; keep direct detail route assertions as applicable |
| `tests/web/spec-plan-product-route.test.tsx` | Update to Specs & Plans queue/detail model |
| `tests/web/a11y-gates.test.tsx` | Replace old route matrix with `/my-work`, typed object routes, task-scoped evidence, releases, and reports |
| `tests/web/responsive-layout.test.tsx` | Replace `/lanes` and `/runs` responsive checks with target IA routes and task-scoped evidence routes |
| `tests/web/dev-tools-gating.test.tsx` | Ensure Dev Tools gating uses `/my-work` as the normal app route and does not import old routes |
| `tests/web/api-hooks.test.tsx` | Update query keys, ProductAction hrefs, typed object APIs, attachment multipart client, and removed old route/action assumptions |
| `tests/e2e/web-product-routes.e2e.test.ts` | Replace old navigation smoke with target IA smoke and removed-route no-match assertions |
| `tests/e2e/run-console.e2e.test.ts` | Replace `/runs/:id` with task-scoped run evidence route or move to runtime-only coverage outside primary product routing |
| `tests/web/fixtures/product-api-mock.ts` | Replace mocked old route payloads with typed route and attachment/readiness payloads |
| `tests/web/fixtures/product-data.ts` | Replace lane/runtime registry fixtures with Requirement, Initiative, Tech Debt, Spec/Plan, Task, Bug, Release, Attachment, and readiness fixtures |

Negative route assertions must cover every removed family: `/lanes`, `/lanes/requirements`, `/pipeline`, `/work-items`, `/work-items/wi-1`, `/work-items/wi-1/spec-plan`, `/specs`, `/plans`, `/packages`, `/packages/pkg-1`, `/runs`, `/runs/run-1`, `/reviews`, and `/reviews/review-1`.

Forbidden:

- old/new UI switch;
- compatibility route aliases for the old navigation;
- fallback shell;
- redirects from removed product route families;
- adapter that accepts both old and new navigation models;
- hidden duplicate primary nav;
- hidden old route trees reachable by direct URL;
- preserving old terms in active UI copy to make tests easier;
- retaining runtime object pages as top-level product destinations.

## Implementation Sequencing Recommendation

This redesign is larger than a single small patch. Implementation planning should split it into controlled slices while preserving the final no-baggage state:

1. Contracts and read-model decision for Task, Initiative, Tech Debt, typed surfaces, and attachments.
2. App shell and route IA replacement.
3. `My Work` queue and typed object list pages.
4. Requirement detail with MDXEditor and Evidence Attachments.
5. Specs & Plans queues and detail authoring.
6. Initiative, Tech Debt, Task, and Bug pages.
7. Move runtime object surfaces under evidence sections.
8. Board, Releases, and Reports alignment.
9. Route cleanup, old navigation removal, naming guards, and visual QA.

Temporary intermediate commits may exist on the feature branch, but the final branch must not leave the old navigation or compatibility paths active.

## Testing And Verification

Required verification:

- Contract tests for new/changed read models.
- API tests for attachment upload/list/resolve/link/delete safety.
- API tests rejecting base64 attachment upload payloads, raw public storage URLs in Markdown, `data:` image URLs, `file:` image URLs, `blob:` image URLs, and unsupported MDX/HTML content.
- API tests proving attachment resolve enforces permissions and renders archived/tombstoned references safely.
- API tests for Task relationships and package/run/review evidence projection.
- API tests proving package generation for Task requires current approved SpecRevision and PlanRevision, and proving audited manual/emergency exceptions cannot authorize package generation, runtime enqueue, review/test gates, or release readiness.
- API tests proving release readiness blocks and unblocks based on scoped review and Test/Acceptance evidence.
- Web tests for the new app shell navigation.
- Web route tests proving `/lanes`, `/pipeline`, `/work-items`, `/packages`, `/runs`, and `/reviews` route families are inactive no-match routes and are not redirects or aliases.
- Web tests for `My Work` role-aware queue grouping.
- Web tests for Requirements, Initiatives, Tech Debt, Specs & Plans, Tasks, Bugs, Board, Releases, and Reports route rendering.
- Web tests proving runtime evidence is reachable from object pages without being top-level navigation.
- Editor tests for Markdown round-trip, source toggle, read-only mode, image insertion, attachment reference rendering, and unsaved-change guard.
- Editor tests proving paste, drag/drop, toolbar image insert, and source mode cannot persist inline base64, `data:`, `file:`, `blob:`, or raw public storage image references.
- Editor tests proving unsupported MDX/HTML is rejected or normalized before persistence.
- Attachment tests proving base64 image bodies are rejected or normalized away.
- Attachment tests proving broken, unauthorized, archived, deleted, or tombstoned references render safe unavailable evidence blocks.
- Accessibility tests for editor toolbar, dialogs, attachment picker, keyboard navigation, and focus states.
- Playwright smoke and screenshots at 375, 768, 1024, and 1440 px.
- Naming/route guard proving old primary navigation routes and labels are not active product surfaces.

Manual product validation:

- A Product user can create and edit a Requirement with images.
- A Product or Manager user can create and edit an Initiative with child Requirements/Bugs/Tech Debt and evidence.
- A Tech Lead or Architect can create and edit Tech Debt with affected modules, migration Tasks, behavior-preservation validation, and evidence.
- A Tech Lead can author/review Spec and Plan while Product, Dev, and QA can read.
- A Developer can work from Tasks and see package/run/review evidence without opening a runtime object browser.
- QA can create/verify a Bug with screenshots/logs and connect it to Tasks and Releases.
- Release Owner can inspect readiness by Initiative, Requirement, Tech Debt, Task, Bug, and evidence.
- Manager can use Dashboard/Reports without knowing runtime object internals.

## Acceptance Criteria

- Primary navigation is `Dashboard / My Work / Requirements / Specs & Plans / Tasks / Bugs / Board / Releases / Reports`.
- `My Work` is the default landing page.
- Initiative, Requirement, Spec, Plan, Task, Bug, Tech Debt, and Release pages are the typed user-facing lifecycle surfaces, with Initiative and Tech Debt reachable from secondary entry points rather than first-level sidebar items.
- Task is first-class and developer-facing.
- Execution Packages, Runs, Review Packets, and traces are accessible as evidence, not primary navigation.
- `/lanes`, `/pipeline`, `/work-items`, `/packages`, `/runs`, and `/reviews` route families are not active product routes, redirects, aliases, or hidden fallbacks.
- Requirement detail shows `Brief -> Spec -> Plan -> Tasks -> Bugs/Test -> Release -> Evidence`.
- Initiative detail shows `Outcome -> Scope -> Child Requirements/Bugs/Tech Debt -> Milestones -> Release Intent -> Evidence`.
- Tech Debt detail shows `Current Pain -> Desired Invariant -> Affected Modules -> Spec -> Plan -> Migration Tasks -> Validation -> Evidence`.
- Spec and Plan are visible to all relevant roles, with Tech Lead / Architect edit and review responsibility.
- Task package generation preserves approved Spec/Plan revision authority and independent/manual Tasks cannot bypass release-scoped gates.
- Release readiness is gated by scoped review and Test/Acceptance evidence.
- MDXEditor is the standard narrative editor wrapper.
- Markdown is the canonical persisted narrative format.
- Images insert through Attachment API and Markdown attachment references.
- Evidence Attachments are first-class reusable evidence objects.
- Structured workflow data remains structured and queryable.
- No legacy route, navigation, or compatibility UI remains for the replaced IA.
