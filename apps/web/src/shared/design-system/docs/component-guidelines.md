# ForgeLoop Web Component Guidelines

This design system layer is shared infrastructure. Keep primitives business-agnostic and compose product pages from layout primitives plus focused UI controls.

## Composition Rules

- Do not build card-in-card page composition. `Section` is a page or layout section, not a nested card container.
- Keep route shell navigation out of UI primitives. `AppShell`, `SidebarNav`, and `Topbar` provide structure only.
- Use `fl-*` classes for layout primitives and shared UI.
- Use `Section`, `DetailLayout`, `SplitPane`, `ActionRail`, `Table`, `DataTable`, and `Drawer` according to page intent instead of route-local container patterns.
- Keep developer payload inspection in the gated Dev Tools route.
- Keep all global CSS in `apps/web/src/shared/design-system/theme/css-variables.css`.

## Accessibility Rules

- Import shared primitives from the public barrels: `shared/ui`, `shared/layout`, and `shared/design-system`.
- `IconButton` always requires a stable accessible `label`.
- Buttons must keep semantic button markup and clear accessible names.
- Loading buttons must preserve the action context in their accessible name.
- Dialogs and drawers need visible titles. Use `DialogClose` or `DrawerClose` with an accessible `label` for dismissible flows.
- Toast actions must use `ToastAction`; toast dismissal must use `ToastClose` with an accessible `label`.
- Status colors must be paired with visible text. Do not rely on color alone; use `StatusPill` copy that names the state.

## Token Rules

- Prefer token CSS variables and Tailwind `fl-*` theme names over raw values.
- Keep colors balanced across neutral, blue, green, amber, and red families; avoid one-hue page themes.
- Add tokens only when two or more components share the need.
