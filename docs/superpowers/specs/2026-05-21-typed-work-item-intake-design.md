# Typed Work Item Intake Design

## Status

User-approved child design draft under `2026-05-21-main-delivery-product-closure-parallelization-design.md`.

This spec defines Stream B: replacing generic Work Item creation with typed intake for Initiative, Requirement, Bug, and Tech Debt.

## Context

The PRD defines Work Item as a typed cross-role business object:

- Initiative
- Requirement
- Bug
- Tech Debt

The current Web create form is generic:

- kind;
- title;
- goal;
- success criteria;
- priority;
- risk.

The current product language still has remnants of coarse owner semantics in the create surface. That is not enough for a product that routes different Work Item types into different lanes and asks different roles to act on different information.

## Goal

Make Work Item creation type-aware and driver-oriented.

Each Work Item type should capture the minimum information needed to create a useful Work Item, route it to the correct lane, generate better Spec/Plan context, and support Delivery Cockpit readiness without creating a coarse Work Item Owner product surface.

## Non-Goals

- No Delivery Action / Review / Release decision redesign.
- No Package, Run, Review, or Release route changes.
- No Evolution Loop or Retrospective implementation.
- No initiative decomposition engine.
- No separate `/requirements`, `/bugs`, `/tech-debt`, or `/initiatives` object route family.
- No generic custom-field builder.
- No legacy Work Item Owner page, lane, route, query key, or product copy.
- No compatibility create endpoint that accepts both old and new product payloads.

## Product Model

### Work Item Drivers

The product surface should speak in Work Item Driver terms:

- Initiative Driver
- Requirement Driver
- Bug Driver
- Tech Debt Driver

The UI must not present a single Work Item Owner workbench or imply that all Work Items have the same intake responsibilities.

This stream must destructively migrate active product-facing Work Item owner language to Driver language.

Required direction:

- Public create/update DTOs use `driver_actor_id`.
- Web create forms use Driver labels and variables.
- New fixtures, tests, route copy, and docs use Driver language.
- Existing `owner_actor_id` may remain only as an internal persistence column if a database column rename is intentionally deferred, but it must be hidden behind repository mapping and must not leak through product-facing contracts touched by this stream.
- If the implementation chooses to rename the persistence field too, it must do so in the same branch without compatibility aliases.

Do not accept both `owner_actor_id` and `driver_actor_id` in the public create API. There is one active product contract.

### Typed Intake Context

Work Item should gain a structured intake context instead of forcing all type-specific information into generic goal text.

Conceptual shape:

```ts
type WorkItemIntakeContext =
  | RequirementIntakeContext
  | BugIntakeContext
  | TechDebtIntakeContext
  | InitiativeIntakeContext;
```

The exact storage can be a JSON object on Work Item or an equivalent first-class typed field group, but it must be:

- schema validated;
- included in create/update read models;
- available for later Work Item detail/cockpit typed brief display;
- available to Spec draft generation context when implemented;
- not stored only as formatted prose.

### Requirement Intake

Capture:

- user or stakeholder problem;
- desired outcome;
- acceptance criteria;
- in-scope boundaries;
- out-of-scope boundaries;
- dependencies or affected surfaces;
- launch or rollout notes when known.

Default:

- risk: medium;
- lane after create: `requirements`;
- success criteria seeded from acceptance criteria.

### Bug Intake

Capture:

- impact summary;
- observed behavior;
- expected behavior;
- reproduction steps;
- affected environment;
- suspected area if known;
- regression risk;
- verification path.

Default:

- risk: high unless user chooses otherwise;
- lane after create: `bugs`;
- success criteria seeded from expected behavior and verification path.

### Tech Debt Intake

Capture:

- current pain or risk;
- desired invariant or target architecture;
- affected modules;
- migration constraints;
- behavior preservation requirements;
- rollback or reversibility notes;
- validation strategy.

Default:

- risk: medium;
- lane after create: `tech-debt`;
- success criteria seeded from invariant and validation strategy.

### Initiative Intake

Capture:

- business outcome;
- scope narrative;
- milestone intent;
- child Work Item breakdown assumptions;
- success metrics;
- major risks;
- cross-item coordination notes.

Default:

- risk: medium;
- lane after create: `initiatives`;
- success criteria seeded from success metrics.

Initiative intake must not pretend the Initiative itself is directly executable unless it later gains approved planning and packages. It should route users to breakdown/readiness context.

## Create Flow

The `/work-items/new` page should become a typed intake flow:

1. Select Work Item type.
2. Show type-specific fields and guidance.
3. Keep common fields visible:
   - title;
   - priority;
   - risk;
   - driver actor;
   - success criteria preview.
4. Validate type-specific required fields.
5. Create Work Item with normalized generic fields plus structured intake context.
6. Navigate to `/work-items/:id?lane=<default-lane-for-kind>`.

The form should feel like one product workflow, not four separate apps.

## Data Normalization

Each intake type must map into the existing cross-type Work Item fields:

- `title`
- `goal`
- `success_criteria`
- `priority`
- `risk`
- driver/owner actor field depending on the selected naming migration
- structured `intake_context`

Rules:

- `goal` should be a concise normalized summary, not a dump of all type fields.
- `success_criteria` should be derived from explicit validation/acceptance fields and editable before submit.
- Structured intake context must preserve the detailed type-specific fields.
- Empty optional fields should be omitted or normalized consistently.

## API And Contract Scope

The create command contract should support typed intake in a first-class way.

Likely changes:

- Add Work Item intake context schemas to contracts.
- Extend create Work Item DTO with the typed context.
- Rename product-facing create/update payloads from `owner_actor_id` to `driver_actor_id` destructively.
- Map to any retained internal persistence field in one repository boundary only; do not expose aliases.
- Update Work Item response schemas if they exist in contracts.
- Update repository schema/mapper if Work Item stores intake context.
- Update object event metadata only if needed to reference the typed context safely.

If the branch chooses not to rename the underlying database column, it must still avoid product-facing Owner vocabulary and must document the repository mapping as an internal persistence detail.

## Web Scope

Likely files:

- `apps/web/src/features/work-items/create-work-item-form.tsx`
- new `apps/web/src/features/work-items/intake/*`
- `apps/web/src/shared/api/commands.ts`
- `apps/web/src/shared/api/types.ts`
- `apps/web/src/features/product-lanes/product-lanes.ts` only if post-create routing needs shared helpers
- Work Item fixtures and tests

Avoid:

- Package, Run, Review, and Release pages.
- Delivery decision ProductAction changes.
- Work Item Delivery Cockpit page and `delivery-cockpit/*` edits during parallel A/B work.
- Product Lanes projection edits; use existing kind-to-lane helpers for post-create routing.
- Broad Work Item Delivery Cockpit typed brief rendering. Showing structured intake in the cockpit is deferred until after A/B merge.

## UI Requirements

- Use existing form primitives.
- Use progressive, type-specific sections rather than one long generic form.
- Keep common fields stable when switching type where possible.
- Recompute default risk and success criteria only before the user edits them manually.
- Show concise type guidance without turning the page into documentation.
- On mobile, stack fields without horizontal scroll.
- Do not use card-in-card layout.

## Testing

Required tests:

- Contract tests for typed intake schemas and create payload validation.
- API tests for creating each Work Item kind with valid typed intake.
- API rejection tests for missing required type-specific fields.
- Repository/schema tests if a new persisted intake field is added.
- Web form tests for each Work Item type.
- Web test that changing type updates fields, defaults, and validation.
- Web test that post-create navigation uses the correct lane query.
- Naming guard test that `work-item-owner` does not appear in active product route/copy/query keys/fixtures.
- Test or compile assertion that typed intake does not modify ProductAction command schemas.

## Acceptance Criteria

- Users can create Initiative, Requirement, Bug, and Tech Debt Work Items through type-specific intake.
- Created Work Items preserve both normalized generic fields and structured type-specific context.
- Post-create navigation opens the correct lane-aware Work Item Cockpit.
- Structured intake context is persisted and queryable, but cockpit rendering of that context is deferred to the post-merge UI/typed brief pass.
- New product UI uses Driver language, not coarse Work Item Owner language.
- No compatibility create path or fallback old form remains.
- The stream does not touch delivery decision pages owned by Stream A.
