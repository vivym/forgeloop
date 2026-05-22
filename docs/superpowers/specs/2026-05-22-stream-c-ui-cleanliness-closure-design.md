# Stream C UI Cleanliness Closure Design

## Status

User-approved child design draft under `2026-05-21-main-delivery-product-closure-parallelization-design.md`.

This spec defines Stream C: a destructive Tailwind-first cleanup of the Web product visual layer after Delivery Action & Decision UX Closure and Typed Work Item Intake have merged.

## Context

ForgeLoop now has product routes for the main PRD delivery loop:

- Product Lanes.
- Pipeline.
- Work Items and typed Work Item intake.
- Work Item Delivery Cockpit.
- Spec & Plan pages.
- Execution Packages.
- Run Console.
- Review Packets.
- Releases.
- Gated Dev Tools.

Streams A and B closed the remaining main-flow UX gaps for delivery decisions and typed Work Item intake. The remaining product gap is visual and interaction coherence:

- The Web app has React Router, Radix primitives, TanStack Query, Tailwind v4, and a `shared/ui` / `shared/layout` layer, but the actual visual system is still dominated by global vanilla CSS classes.
- `apps/web/src/shared/design-system/theme/css-variables.css` is doing too much: Tailwind import, theme variables, reset, component styling, layout styling, page-specific styling, and responsive behavior.
- Global classes such as `.fl-button`, `.fl-section`, `.fl-detail-layout`, `.fl-action-rail`, `.fl-table`, `.fl-run-console`, `.fl-pipeline-stage`, `.empty`, `.metric`, `.pill-list`, `.state-grid`, `.form-grid`, `.button-row`, `.danger-text`, `.timeline-list`, and `.timeline-entry` are becoming a second styling API.
- Tests already assert several `.fl-*` selectors, which risks freezing historical styling as a product contract.
- TypeScript token files and the CSS-first Tailwind theme duplicate intent. There should be one active visual source of truth.
- The current UI is usable, but still reads like a recently productized internal console rather than a polished, calm, information-dense product.

The project is not launched. Architectural superiority is more important than migration comfort. The user direction is explicit: do not preserve historical baggage, compatibility layers, old Workbench vocabulary, or coarse Work Item Owner product surfaces.

## Goal

Make the Web app feel like one polished product and make Tailwind CSS the default visual implementation architecture.

The end state should be:

- One Tailwind-first visual theme.
- One reusable primitives layer.
- Product pages composed from primitives and minimal page-local Tailwind layout.
- No active global vanilla CSS component system.
- No old visual class API preserved for compatibility.
- No class-selector tests that lock in historical styling details.
- No card-in-card page composition, debug-style raw panels, or old Workbench visual language.
- Verified responsive behavior at 375, 768, 1024, and 1440 px.

## Non-Goals

- No backend product model changes.
- No Delivery Action, Typed Work Item, runtime readiness, Review, Release, or Work Item intake semantics changes beyond visual composition needed to render them cleanly.
- No Evolution Loop, Retrospective, Replay Diagnose Learn Codify Improve implementation.
- No new route family.
- No legacy styling compatibility layer.
- No old/new theme switch.
- No incremental adapter that keeps `.fl-*` as a long-lived styling API.
- No marketing landing page, decorative hero, animated brand refresh, dark-mode toggle, or broad illustration system.
- No wholesale frontend framework migration away from React Router, Vite, Radix, TanStack Query, or Tailwind.

## Product And UX Principles

### Product Personality

ForgeLoop should feel like a focused delivery operating system:

- calm;
- dense but readable;
- decisive;
- professional;
- operational, not decorative;
- built for repeated daily use.

The UI should prioritize scanning, comparison, decision readiness, and safe command execution. It should not read like a public SaaS marketing page.

### Visual Direction

Use a restrained operations-product theme:

- light neutral background;
- white and slightly raised surfaces;
- strong text contrast;
- blue as the primary action color;
- amber for warning / attention / decision friction;
- green for success / ready;
- red for destructive / blocked / failed;
- cyan or sky only for informational secondary states;
- 8 px maximum card/panel radius unless a pill shape is semantically required.

Avoid:

- one-note blue-only screens;
- purple-heavy gradients;
- decorative orbs / bokeh / blobs;
- oversized hero typography inside product pages;
- rounded text chips used where a table, status pill, icon button, or segmented control would be clearer;
- cards inside cards.

### Interaction Direction

Use familiar controls:

- icon buttons for navigation toggles and compact tools, with accessible labels;
- buttons for clear commands;
- status pills for state;
- badges for classification and metadata;
- segmented controls or tabs for mode switches;
- drawers/dialogs for bounded decisions;
- tables with mobile card fallback for dense registries;
- inline notices for degraded, blocked, empty, and error states.

Use lucide icons where icons are needed. Do not use emoji icons.

## Architecture Decision

### Choose Tailwind-First Primitives

The implementation should destructively migrate the Web visual layer to Tailwind-first primitives:

1. Keep Tailwind v4 and the existing Vite plugin.
2. Keep a single CSS entry imported from `apps/web/src/app/root.tsx`.
3. Use CSS only for Tailwind import, `@theme`, base reset, global body/html behavior, focus-visible defaults, reduced-motion policy, and portal-level constraints that would be duplicated unsafely in every component.
4. Move component styling into React primitives through Tailwind utility strings and `cn()`.
5. Use a variant helper such as `class-variance-authority` only where it removes real duplication for primitives like Button, Badge, StatusPill, Input, Dialog, Drawer, and Table.
6. Delete or collapse unused TypeScript token and Tailwind preset files if no active consumer needs them. The CSS-first Tailwind theme is the source of truth.

This is preferred over keeping the current `.fl-*` class system because the current class system is the historical baggage. It forces product pages, tests, and components to depend on a private CSS naming convention instead of explicit component APIs and Tailwind theme tokens.

Tailwind theme names and component variants must not keep the old `fl-*` prefix. Use neutral product theme names such as `surface`, `primary`, `warning`, `card`, and `toast`. The no-legacy scan should therefore have no conflict with active Tailwind class names.

### What Vanilla CSS May Remain

Vanilla CSS may remain only for:

- `@import "tailwindcss"`;
- `@theme` values and any Tailwind v4 source scanning directives needed by the project;
- `:root` values only when Tailwind requires CSS custom properties that are not expressible through `@theme`;
- `html`, `body`, `*`, form font inheritance, and basic link defaults;
- global `:focus-visible` policy if implemented once as a base rule;
- reduced-motion base rules;
- Radix portal container or overlay defaults only if putting them in every primitive would create duplication or bugs.

Vanilla CSS must not define product component classes, page layout classes, table classes, action rail classes, run console classes, pipeline card classes, helper utility classes, or legacy selector aliases.

Radix dialog, drawer, toast, and overlay visuals should live inside their owning primitives as Tailwind utilities. Global CSS is reserved only for unavoidable base or portal constraints, not for reusable Radix visual classes.

### What Must Be Removed

Remove the active visual role of:

- `.fl-*` component and layout classes;
- `.empty`;
- `.metric`;
- `.pill-list`;
- `.state-grid`;
- `.form-grid`;
- `.button-row`;
- `.danger-text`;
- `.timeline-list`;
- `.timeline-entry`;
- page-specific global classes such as `.fl-pipeline-stage` and `.fl-run-console`.

Do not replace these with one-for-one global aliases. Replace them with primitives or explicit Tailwind utilities in the owning component.

## Primitive Layer Design

`apps/web/src/shared/ui` and `apps/web/src/shared/layout` should become the only reusable product visual API.

### Shared UI Primitives

Required primitive contracts:

- `Button`
  - variants: primary, secondary, ghost, danger;
  - sizes: sm, md;
  - loading label remains accessible;
  - supports leading/trailing icon slots;
  - no dependency on `.fl-button`.
- `IconButton`
  - fixed square dimensions;
  - accessible `label`;
  - variants consistent with Button.
- `Badge`
  - tones: neutral, primary, success, warning, danger, info;
  - classification only, not command state.
- `StatusPill`
  - same status tones;
  - optional visual dot;
  - used for state/readiness.
- `Input`, `Select`, `Textarea`, `Checkbox`
  - invalid state;
  - visible focus;
  - disabled state;
  - consistent density.
- `Field`
  - label, hint, error, required marker when needed;
  - replaces repeated bare-label form markup.
- `Dialog`, `Drawer`, `Toast`
  - Radix semantics retained;
  - Tailwind classes internal;
  - close controls accessible;
  - portal layering from shared z-index theme.
- `DataTable`
  - desktop table;
  - mobile card fallback;
  - stable responsive contract;
  - no horizontal overflow on supported breakpoints.
- `EmptyState`
  - full-section empty state.
- `InlineNotice`
  - compact info/warning/error/success notice for loading, degraded, disabled, blocked, and API error states.
- `Skeleton`
  - respects reduced motion.
- `Timeline`
  - consistent event rhythm and wrapping.

### Shared Layout Primitives

Required layout contracts:

- `AppShell`
  - left product navigation on desktop;
  - mobile navigation sheet;
  - topbar with project, actor, runtime/durability context, and development-only Dev Tools visibility;
  - no placeholder-only topbar copy.
- `SidebarNav`
  - active route state;
  - compact product nav;
  - no Workbench legacy vocabulary.
- `Topbar`
  - project context, actor context, and environment/durability status;
  - optional global search may remain out of scope if no query source exists.

Topbar data must come from real product context, not placeholder copy. Use the existing `ProjectContext`, `ActorContext`, and `RuntimeFlags` where they satisfy the contract. Runtime/durability status may show only data that is already available through an existing product-safe context or query. If no safe data source exists for a status slot, omit that slot or create a bounded read-only product context in the implementation plan; do not ship filler text such as "Product workspace" to satisfy layout.
- `PageHeader`
  - eyebrow, title, subtitle, actions;
  - stable responsive wrapping;
  - title text must not occlude actions.
- `Section`
  - section header, description, actions, body;
  - no card-in-card default.
- `DetailLayout`
  - object content plus Action Rail;
  - desktop right rail;
  - tablet/mobile rail becomes inline before or after content according to the page decision;
  - no horizontal overflow.
- `ActionRail`
  - state-aware command and decision grouping;
  - compact disabled reason and error notices;
  - consistent visual weight across Work Item, Package, Review, and Release pages.
- `MetricGrid` / `Metric`
  - replaces `.state-grid` and `.metric`;
  - used for stage counts, readiness, and cockpit summaries.
- `InlineActions`
  - replaces `.pill-list` where the content is actions or small related controls.
- `PillGroup`
  - replaces `.pill-list` where the content is badges/status labels.
- `MetadataGrid`
  - replaces `.fl-metadata-grid`;
  - used for object detail metadata.
- `ObjectSummary`
  - replaces repeated entity-summary markup.

Each primitive should be understandable by its props and tests. Consumers should not need to know internal class names.

## Page Scope

Stream C owns visual cleanup across all active Web product pages:

- Product Lanes.
- Pipeline.
- Work Items list and typed create flow.
- Work Item Delivery Cockpit.
- Spec & Plan Work Item flow.
- Spec and Plan direct routes.
- Execution Package list and detail.
- Run Console list and detail.
- Review Packet list and detail.
- Release list and detail.
- Dev Tools only as needed to keep it visually isolated and gated.

References to typed brief, replay, timeline, evidence, and cockpit summaries in this stream mean visual composition of data that is already available after Streams A and B. Stream C must not add new typed-brief product semantics, new replay/evolution data sources, or Evolution Loop behavior.

### Product Lanes

Target:

- lane switcher uses a controlled primitive rather than button-like links scattered in a `pill-list`;
- lane summary uses `MetricGrid`;
- selected item state uses `PillGroup`;
- queue table remains dense on desktop and converts cleanly to cards on mobile;
- Action Rail matches Work Item and Release pages.

### Pipeline

Target:

- stage cards use a local component with Tailwind classes, not global `.fl-pipeline-*`;
- metrics use `MetricGrid` or a stage-local metric primitive;
- degraded sources use `InlineNotice` / `PillGroup`;
- integration and test-acceptance details are readable without creating nested cards.

### Work Items And Typed Intake

Target:

- Work Items list has a filter/header rhythm consistent with other registries;
- typed intake uses `Field`, `MetricGrid`, `InlineNotice`, and consistent action placement;
- driver language remains visible where relevant;
- no Work Item Owner copy is introduced;
- required field errors do not shift layout unpredictably.

### Work Item Delivery Cockpit

Target:

- cockpit summary, stage rail, typed brief, artifact sections, package matrix, execution, review, integration, quality gate, release readiness, evidence, and activity timeline use shared primitives;
- long blocker text wraps cleanly;
- degraded and blocked states are visually distinct from empty states;
- Action Rail matches Package, Review, and Release rails.

### Specs And Plans

Target:

- direct routes and Work Item flow share the same artifact summary, revision list, replay/timeline, and lifecycle action primitives;
- status filters use tabs/segmented controls, not ad hoc pill lists;
- package generation callout is a notice/action area, not a bare empty paragraph.

### Packages, Runs, Reviews, Releases

Target:

- registries use `DataTable`;
- detail metadata uses `MetadataGrid`;
- object actions use `ActionRail`, `Drawer`, `Dialog`, and `InlineNotice`;
- Run Console event stream keeps a console-like dense area but is implemented locally with Tailwind and no global `.fl-run-console` classes;
- Review and Release decision forms preserve errors, disabled reasons, and pending states in consistent notices;
- high-risk actions are visually distinct without relying on heavy decoration.

## Design System Theme

The active Tailwind theme should define:

- colors:
  - `background`;
  - `surface`;
  - `surface-raised`;
  - `surface-muted`;
  - `border`;
  - `border-strong`;
  - `text-primary`;
  - `text-secondary`;
  - `text-muted`;
  - `primary`;
  - `primary-hover`;
  - `primary-soft`;
  - `success`;
  - `success-soft`;
  - `warning`;
  - `warning-soft`;
  - `danger`;
  - `danger-soft`;
  - `info`;
  - `info-soft`;
  - `focus`;
- fonts:
  - system-first sans unless a product font is explicitly added with load/performance handling;
  - mono for run/event/code-like content;
- radius:
  - `xs`, `sm`, `md`, `card`, `pill`;
- shadows:
  - subtle only, used sparingly;
- z-index:
  - sticky, overlay, drawer, modal, toast;
- motion:
  - fast/base/slow duration and standard easing.

Theme names should be Tailwind-friendly and used directly in class names. Avoid duplicating the same values in unused TypeScript token files unless a real runtime consumer exists.

## Accessibility And Responsiveness

Hard requirements:

- all interactive controls have accessible names;
- icon-only buttons use visible tooltips only when helpful and always have accessible labels;
- focus-visible states are present and pass contrast expectations;
- reduced motion is respected for skeletons, transitions, and animations;
- status is not communicated by color alone;
- 375 px mobile layouts do not horizontally scroll;
- 768 px tablet layouts retain usable density without collapsing everything unnecessarily;
- 1024 px layouts work with inline rails or stacked rails as designed;
- 1440 px layouts remain constrained and do not sprawl;
- long Work Item titles, blocker text, run events, ids, file paths, and evidence labels wrap without clipping controls.

## Testing And Verification

Required tests:

- Web primitive tests verifying accessible names, loading states, invalid states, dialog/drawer/toast close semantics, and no card-in-card composition.
- A design-system no-legacy test that fails if active product source uses old global visual class tokens in `className`, `class`, or equivalent rendered class composition:
  - `fl-*`;
  - `empty`;
  - `metric`;
  - `pill-list`;
  - `state-grid`;
  - `form-grid`;
  - `button-row`;
  - `danger-text`;
  - `timeline-list`;
  - `timeline-entry`.
  The scan must be token-aware, not substring-based. It must cover rendered class surfaces such as JSX `className`, HTML `class`, `cn(...)` arguments, CVA variant definitions, and test selector assertions. It must not reject ordinary identifiers, component names, props, or user-facing copy such as `MetricGrid`, `emptyMessage`, `emptyRunEvents`, or "No data" text. The forbidden surface is the styling class API, not English words, component names, or variable names.
  The scan should cover `apps/web/src` and Web tests that assert product UI behavior. It should include gated Dev Tools source because Dev Tools still shares the visual primitive layer, but it may exclude generated files, screenshots, docs, and fixture data that do not define rendered class names.
- Existing tests that assert `.fl-*` selectors must be rewritten to semantic queries, role/name checks, text checks, or explicit data attributes for behavior that is not visual.
- Accessibility token/contrast tests against the active Tailwind theme source.
- Responsive layout tests for shell landmarks, Action Rail placement, mobile navigation, and DataTable fallback.
- Route-level Web tests for the main product pages.
- Playwright visual smoke at 375, 768, 1024, and 1440 px for populated and degraded routes.
- Overflow checks comparing `scrollWidth` and `clientWidth`.
- Screenshot artifacts reviewed for:
  - no horizontal overflow;
  - no overlapping text/buttons;
  - no stale debug/Workbench visual language;
  - no card-in-card page composition;
  - consistent empty/loading/error/degraded states;
  - usable Action Rail on detail routes.

The implementation plan must name the visual-smoke harness explicitly: command, route fixture setup, viewport matrix, and screenshot artifact path. The existing `tests/e2e/web-product-routes.e2e.test.ts` harness and `test-results/web-product-routes/` artifact shape are the expected starting point unless implementation replaces them with an equivalent route-level visual smoke harness.

Expected verification commands:

```bash
pnpm --filter @forgeloop/web typecheck
pnpm --filter @forgeloop/web build
pnpm vitest run tests/web --pool=forks --no-file-parallelism --maxWorkers=1
pnpm vitest run tests/e2e/web-product-routes.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm test
pnpm build
```

The implementation plan may split these commands across checkpoints, but final delivery must run the Web-specific verification and the full workspace verification unless a pre-existing unrelated failure is documented.

## Migration Strategy

This is not a compatibility migration. Use a destructive cleanup sequence:

1. Establish the Tailwind-first theme entry.
2. Rewrite shared UI primitives to internal Tailwind utilities.
3. Rewrite shared layout primitives to internal Tailwind utilities.
4. Add missing primitives that replace repeated page-local patterns.
5. Migrate product pages from global classes to primitives and local Tailwind utilities.
6. Rewrite tests away from old class selectors.
7. Delete old global component/page CSS and unused token/preset files.
8. Add no-legacy scan coverage.
9. Run visual smoke and fix issues found in screenshots.

Do not add temporary dual-rendered components, old/new theme flags, or alias classes.

## Risks And Controls

### Risk: Large Diff Across Many Web Files

Control:

- Keep the scope to Web visual architecture and composition.
- Do not touch API/domain behavior except tests or fixtures needed for rendering.
- Use primitives first, then migrate pages.
- Preserve user-visible behavior while changing visual implementation.

### Risk: Tests Become Too Brittle

Control:

- Prefer role/name/text/behavior assertions.
- Use `data-testid` only for non-semantic structures such as run event streams or screenshot-specific anchors.
- Do not assert exact Tailwind class strings except in no-legacy scans.

### Risk: Tailwind Utilities Become Noisy

Control:

- Put repeated visual patterns in primitives.
- Use `cn()` and variants for reusable components.
- Keep page-local utilities limited to layout composition.

### Risk: Theme Values Drift

Control:

- One active theme source.
- Delete duplicate unused token modules.
- Add contrast and no-legacy tests.

## Acceptance Criteria

- All active Web product pages render through Tailwind-first primitives and page-local Tailwind utilities.
- The old global component/page CSS class API is removed.
- The only remaining vanilla CSS is the narrow Tailwind/base layer allowed by this spec.
- Active product source does not use `fl-*`, `empty`, `metric`, `pill-list`, `state-grid`, `form-grid`, `button-row`, `danger-text`, `timeline-list`, or `timeline-entry` as styling class tokens.
- Product copy does not reintroduce Workbench as the product entry or Work Item Owner as the coarse Work Item organizing concept.
- The app has one visual theme and one reusable primitive layer.
- Pages are clean, calm, responsive, and information-dense.
- Populated and degraded route screenshots pass visual review at 375, 768, 1024, and 1440 px.
- Web typecheck, Web build, Web tests, route e2e visual smoke, full test, and full build pass or document only unrelated pre-existing failures.
