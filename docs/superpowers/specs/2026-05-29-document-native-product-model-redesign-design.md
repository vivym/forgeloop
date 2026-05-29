# Document-Native Product Model Redesign Design

## Status

Draft for user review.

## Context

The current product workspace redesign improved route structure and removed several legacy product-surface terms, but the visual and product model still feel wrong because the hierarchy is not document-native enough.

This spec supersedes the object-relationship and naming portions of `docs/superpowers/specs/2026-05-27-product-workspace-core-surface-redesign-design.md`. It keeps that spec's intent to make Development Plan the planning bridge and Plan Item the governed delivery workspace, but tightens the model so Requirement, Bug, Tech Debt, Initiative, Spec, and Implementation Plan are all document-native artifacts where appropriate.

The PRD's older shorthand delivery line describes the high-level delivery sequence. This spec makes the missing planning bridge explicit: source documents do not proceed directly to implementation documents. They first feed a Development Plan, and a Plan Item then enters the Superpowers document workflow.

The corrected product model must align with the Superpowers workflow:

- `superpowers:brainstorming` is an interactive boundary clarification process that writes a Spec Markdown document after the boundary is confirmed.
- `superpowers:writing-plans` writes a Markdown implementation plan document with checkbox steps.
- `superpowers:executing-plans` or `superpowers:subagent-driven-development` consumes that plan document and runs implementation, review, verification, and branch finishing.

ForgeLoop must orchestrate this document workflow. It must not replace it with prematurely structured database objects.

## Problem

The current UI still implies a generic project-management database:

- Requirement is presented mostly as a table row with metadata instead of a first-class product document.
- Development Plan and the Superpowers implementation plan are too easy to confuse.
- Plan Item is visible, but its parent-child relationship with Development Plan is not strong enough.
- Spec and Plan are represented as gate objects, but the product does not consistently communicate that they are Markdown document artifacts.
- Some screens still make the delivery flow feel like disconnected pages instead of a document graph that moves into governed AI execution.

This creates product confusion and risks baking historical baggage into the IA.

## Core Decision

ForgeLoop's product model must be:

```text
Requirement / Bug / Tech Debt / Initiative Document(s)
  -> Development Plan
       -> Plan Item
            -> Brainstorming Session
            -> Spec Markdown Doc
            -> Implementation Plan Markdown Doc
            -> Execution Package
            -> Codex Run
            -> Code Review / QA / Release Evidence
```

This hierarchy is mandatory.

No Requirement, Bug, Tech Debt, or Initiative document may skip directly to Spec, Implementation Plan, Execution Package, or execution.

## Terminology

### Source Document

`Source Document` is the conceptual umbrella for Requirement, Bug, Tech Debt, and Initiative pages. Public UI should normally use the concrete type name instead of the umbrella term.

Examples:

- Requirement Document;
- Bug Document;
- Tech Debt Document;
- Initiative Document.

Each source document has:

- an MDX/Markdown body as the primary content;
- typed properties for filtering, routing, and governance;
- attachments and images;
- comments or decision history where supported;
- links to Development Plans and downstream delivery artifacts.

The body is not a secondary description field. It is the product context authority.

### Development Plan

`Development Plan` is a product and tech-lead planning artifact. It is the parent object that decomposes one or more source documents into delivery slices.

It may look like a document with an embedded planning table, or a planning table with a document header. In either case, it is not the Superpowers `writing-plans` output.

Development Plan answers:

- Which source documents are being planned together?
- What is the development strategy?
- What slices should be delivered?
- What dependencies, ordering, risks, and release considerations exist?
- Which Plan Items should enter the Superpowers flow?

### Plan Item

`Plan Item` is a child row or slice inside a Development Plan.

It is the smallest governed delivery unit that can enter:

```text
Brainstorming -> Spec Doc -> Implementation Plan Doc -> Execution
```

A Plan Item may reference one or more source documents. It is not a structured task list. It is a governed delivery slice.

### Spec Doc

`Spec Doc` is the Markdown document artifact generated or edited through the Superpowers brainstorming flow.

Spec Doc answers:

- what will be built;
- why it is needed;
- what is in scope and out of scope;
- what boundaries and risks were decided;
- what test and QA strategy is required;
- what open questions remain.

ForgeLoop may track Spec Doc revisions, approval decisions, review loops, and artifact links. The document body remains Markdown.

### Implementation Plan Doc

`Implementation Plan Doc` is the Markdown document artifact generated by `superpowers:writing-plans` for one approved Plan Item Spec.

It is different from Development Plan.

Implementation Plan Doc answers:

- which exact files need to be touched;
- what tests need to be written first;
- what steps an implementation agent should execute;
- what verification commands prove the work;
- what commits/checkpoints are expected.

The checkbox list inside this document remains document content. ForgeLoop must not extract it into first-class structured tasks in this slice.

### Execution Package

`Execution Package` remains the internal runtime authority. It materializes a runnable boundary from the approved Plan Item, approved Spec Doc revision, and approved Implementation Plan Doc revision.

It must not become the primary navigation object.

## Product IA

### Source Document Spaces

Requirement, Bug, Tech Debt, and Initiative spaces must be document-first.

Index pages should behave like mature document databases:

- dense list/table view;
- type-specific columns;
- search and filters;
- planning coverage;
- downstream status;
- last meaningful update;
- next action.

Detail pages must prioritize the document:

- center: MDX/Markdown document editor/viewer;
- right rail: typed properties, driver, priority/severity, risk, status, linked Development Plans, Plan Item coverage, attachments, evidence, releases;
- lower or side section: downstream graph showing Development Plans and Plan Items;
- actions: create Development Plan, link Development Plan, add to existing Development Plan.

There must be no primary action that generates Spec or starts execution directly from a source document.

### Development Plan Workspace

Development Plan is the planning bridge.

The page should combine:

- document header and planning rationale;
- linked source documents;
- plan item table;
- ordering and dependency hints;
- risk and release summary;
- AI-assisted generation state where applicable;
- selected Plan Item inspector.

The Plan Item table should show:

- Plan Item title;
- linked source documents;
- driver / responsible role;
- phase in the Superpowers workflow;
- Spec Doc status;
- Implementation Plan Doc status;
- execution / review / QA summary;
- next action.

Development Plan must not be labelled or described as an Implementation Plan.

### Plan Item Workspace

Plan Item is the governed delivery workspace.

The page should show one coherent path:

```text
Boundary / Brainstorming
  -> Spec Doc
  -> Implementation Plan Doc
  -> Execution
  -> Code Review
  -> QA
  -> Release
```

Recommended layout:

- left rail: compact lifecycle stages;
- center: active document or active run surface;
- right rail: source document links, decisions, reviewers, QA/test expectations, runtime/evidence context;
- top: breadcrumbs from Development Plan and linked source docs.

The current active stage should dominate the center. Adjacent stages should remain visible but compact.

### Document Review Workspace

Spec and Implementation Plan review should be document review, not form review.

Review surfaces must support:

- Markdown document preview;
- revision diff;
- blocker review loop status;
- review comments or decision notes;
- approve / request changes / reject actions;
- link back to the owning Plan Item and Development Plan.

### Execution Workspace

Execution is reached from a Plan Item after approved documents exist.

Execution surfaces should show:

- approved Spec Doc revision;
- approved Implementation Plan Doc revision;
- internal Execution Package state;
- Codex run/session state;
- interrupt / continue / resume controls;
- test evidence;
- PR / diff / review packet;
- QA handoff and release linkage.

Execution Package details may appear in developer and runtime context panels, but not as the primary product object.

## Superpowers Alignment

ForgeLoop must treat skills as first-class workflow adapters:

### Brainstorming

For a Plan Item, ForgeLoop should:

- launch or resume a brainstorming session;
- provide linked source documents and Development Plan context;
- capture questions, answers, and boundary decisions;
- persist the resulting Spec Doc Markdown artifact;
- route the Spec Doc through blocker review and human approval.

### Writing Plans

For an approved Spec Doc, ForgeLoop should:

- launch `superpowers:writing-plans`;
- provide the Spec Doc, source document links, Development Plan, and Plan Item context;
- persist the resulting Implementation Plan Doc Markdown artifact;
- route the plan through blocker review and human approval.

### Execution

For an approved Implementation Plan Doc, ForgeLoop should:

- materialize or validate the internal Execution Package;
- start `superpowers:subagent-driven-development` or `superpowers:executing-plans`;
- preserve run state, interruption, continuation, evidence, commits, PRs, review outcomes, QA outcomes, and release outcomes.

## Naming Rules

Public UI must use these terms:

- `Requirement`, `Bug`, `Tech Debt`, `Initiative` for source document spaces.
- `Development Plan` for the parent planning artifact.
- `Plan Item` for child planning slices.
- `Spec Doc` or `Spec` where the document nature is visually obvious.
- `Implementation Plan Doc` for the Superpowers writing-plans output.
- `Execution` or `Codex Run` for run state.
- `Execution Package` only inside runtime/developer/internal context.

Public UI must not use:

- the old work-item ownership label;
- generic `owner` for source documents or Plan Items;
- generic `source object` as the primary page label;
- `Development Plan` to mean the Superpowers implementation plan;
- `Task` for Plan Item unless a future spec introduces structured task extraction;
- `Execution Package` as primary navigation;
- old subsystem names, old priority-code labels, placeholder sample copy, or other historical baggage terms.

## Data Model Direction

Product contracts must move toward the following conceptual model:

- Source documents have document body content, typed properties, attachments, and downstream links.
- Development Plans have document body content plus child Plan Items.
- Plan Items have source document refs and workflow artifact refs.
- Spec Doc revisions are document artifacts owned by Plan Items.
- Implementation Plan Doc revisions are document artifacts owned by Plan Items.
- Execution Packages reference Plan Items, approved Spec Doc revisions, approved Implementation Plan Doc revisions, policies, checks, source refs, and evidence refs.

No public API should force the frontend to infer document-first concepts from generic work-item records.

Implementation may be staged across commits for reviewability, but the finished slice must not keep public compatibility aliases, old product labels, or dual navigation paths.

## Visual Design Direction

ForgeLoop should feel like a mature AI-native product workspace, not a generic admin CRUD UI.

Design principles:

- document body first for source document detail pages;
- dense but calm document database for source indexes;
- planning table for Development Plans;
- lifecycle workspace for Plan Items;
- compact role-specific rails instead of large explanatory banners;
- restrained color with meaningful status accents;
- no decorative gradient/orb treatment;
- page-specific layouts rather than one shared generic page shell;
- no dead controls.

The target feel is closer to a disciplined hybrid of Notion document/database affordances, Linear operational density, and an AI runtime side rail. It should not become a marketing page or a generic dashboard.

## Route Direction

Recommended public route families:

- `/requirements`
- `/requirements/:requirementId`
- `/bugs`
- `/bugs/:bugId`
- `/tech-debt`
- `/tech-debt/:techDebtId`
- `/initiatives`
- `/initiatives/:initiativeId`
- `/development-plans`
- `/development-plans/:developmentPlanId`
- `/development-plans/:developmentPlanId/items/:planItemId`
- `/development-plans/:developmentPlanId/items/:planItemId/spec`
- `/development-plans/:developmentPlanId/items/:planItemId/implementation-plan`
- `/development-plans/:developmentPlanId/items/:planItemId/execution`
- `/reviews`
- `/qa`
- `/releases`

Routes should preserve the parent-child relationship in breadcrumbs:

```text
Requirement Doc -> Development Plan -> Plan Item -> Spec Doc
Requirement Doc -> Development Plan -> Plan Item -> Implementation Plan Doc
Requirement Doc -> Development Plan -> Plan Item -> Execution
```

## Acceptance Criteria

- Requirement detail is document-first with MDX/Markdown body as the primary surface.
- Bug, Tech Debt, and Initiative detail pages follow type-specific document-first layouts.
- Development Plan is visually and semantically distinct from Implementation Plan Doc.
- Development Plan contains Plan Items and shows source document coverage.
- Plan Item is the only object that can enter Brainstorming, Spec Doc, Implementation Plan Doc, and Execution.
- Spec Doc and Implementation Plan Doc are represented as Markdown document artifacts with revisions and reviews.
- No UI route offers direct source document to Spec generation, Implementation Plan Doc generation, or execution.
- Execution Package is visible only as internal runtime context, not primary product navigation.
- Public copy contains no generic owner labels, generic source-data database labels, placeholder sample wording, or historical subsystem terminology.
- The first viewport on 1280x720 shows real working content rather than explanatory banners.
- Existing route and contract tests are updated to lock these semantics.

## Out Of Scope

- Extracting Implementation Plan checkbox steps into structured task records.
- Building a full Notion-like block editor beyond the existing MDXEditor direction.
- External Jira, Linear, Notion, GitHub Issues, or document sync.
- Full evolution-loop / retrospective learning surfaces.
- Replacing Execution Package as the internal runtime authority.
- Supporting backward-compatible public labels for the old generic source-object model.

## Locked Naming Decisions

- Public navigation may use `Spec` when the page is visibly document-native; artifact labels, review surfaces, and audit trails should use `Spec Doc` when ambiguity matters.
- Public UI must retire the older execution-plan wording as the product-facing name for the Superpowers `writing-plans` output. Use `Implementation Plan Doc`.
- Existing internal names may be migrated in implementation order, but no public route, copy, test fixture, or contract should preserve the misleading label once this redesign lands.
- Development Plan must support persisted document body content from the start. The first implementation may pair a concise Markdown rationale body with a structured Plan Item table, but the object is still a document-backed planning artifact rather than a plain table.
