# ForgeLoop Web Component Guidelines

This design system layer is shared infrastructure. Keep primitives business-agnostic and compose product pages from layout primitives plus focused UI controls.

## Legacy Replacement Map

Replace legacy `.panel` usage by intent:

- Page or content section: `Section`
- Detail page structure: `DetailLayout`
- Sticky or supporting actions: `ActionRail`
- Data grids and row lists: `Table` or `DataTable`
- Temporary side workflow: `Drawer`
- Developer-only raw payloads: `DevToolsRawPanel`

Replace legacy `.workbench-grid` usage with `DetailLayout`, `SplitPane`, or route-specific CSS using `fl-*` class names.

## Composition Rules

- Do not build card-in-card page composition. `Section` is a page or layout section, not a nested card container.
- Keep route shell navigation out of UI primitives. `AppShell`, `SidebarNav`, and `Topbar` provide structure only.
- Use `fl-*` classes for layout primitives and shared UI. Do not add new legacy visual-system classes.
- Keep all global CSS in `apps/web/src/shared/design-system/theme/css-variables.css`.

## Accessibility Rules

- `IconButton` always requires a stable accessible `label`.
- Buttons must keep semantic button markup and clear accessible names.
- Dialogs and drawers need visible titles. Use descriptions when the action has consequences.
- Status colors must be paired with visible text. Do not rely on color alone; use `StatusPill` copy that names the state.

## Token Rules

- Prefer token CSS variables and Tailwind `fl-*` theme names over raw values.
- Keep colors balanced across neutral, blue, green, amber, and red families; avoid one-hue page themes.
- Add tokens only when two or more components share the need.
