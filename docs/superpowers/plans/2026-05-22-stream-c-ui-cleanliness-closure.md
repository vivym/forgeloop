# Stream C UI Cleanliness Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ForgeLoop Web's global vanilla CSS visual system with a Tailwind-first theme, reusable primitives, and clean product-page composition without preserving historical `.fl-*` styling baggage.

**Architecture:** Keep React Router, Vite, Radix, TanStack Query, and the current product route model. Move visual implementation into Tailwind-first `shared/ui` and `shared/layout` primitives, keep only a narrow Tailwind/base CSS entry, migrate product pages by route family, then delete old CSS classes and class-based tests. No business API or product model changes are allowed.

**Tech Stack:** React 19, React Router framework mode, Vite, Tailwind CSS v4, Radix primitives, class-variance-authority, tailwind-merge, lucide-react, Testing Library, Vitest, Playwright.

---

## Scope Check

This spec is large but still one subsystem: the Web visual architecture. Do not split it into backend/API tasks. The implementation should be split by ownership checkpoints so each checkpoint is reviewable:

1. Theme/base CSS.
2. Shared UI primitives.
3. Shared layout primitives and shell.
4. Low-risk product pages.
5. Work Item cockpit and Spec/Plan pages.
6. Package, Run, Review, and Release pages.
7. No-legacy scans and test rewrites.
8. Visual QA and full verification.

## Source Spec

- `docs/superpowers/specs/2026-05-22-stream-c-ui-cleanliness-closure-design.md`

## Existing Structure To Understand First

- App root imports the current global CSS from `apps/web/src/app/root.tsx`.
- Tailwind v4 is already configured through `apps/web/vite.config.ts`.
- Existing styling is mostly in `apps/web/src/shared/design-system/theme/css-variables.css`.
- Existing UI primitives live in `apps/web/src/shared/ui/**`.
- Existing layout primitives live in `apps/web/src/shared/layout/**`.
- Existing product route code lives under `apps/web/src/features/**`.
- Existing Web tests live under `tests/web/**`.
- Existing route visual smoke lives in `tests/e2e/web-product-routes.e2e.test.ts` and writes screenshots under `test-results/web-product-routes/`.

## Target File Structure

### Theme And Style Entry

- Modify first: `apps/web/src/shared/design-system/theme/css-variables.css`
  - During Tasks 1-6, this remains the single CSS entry while neutral Tailwind tokens are introduced and old component classes are removed incrementally.
  - Do not add new global component classes here.
- Create in Task 7: `apps/web/src/shared/styles/theme.css`
  - Final CSS entry. Owns `@import "tailwindcss"`, `@theme`, base reset, focus-visible, reduced motion, html/body defaults.
  - Must not define reusable component classes or page classes.
- Modify in Task 7: `apps/web/src/app/root.tsx`
  - Import `../shared/styles/theme.css`.
- Delete in Task 7: `apps/web/src/shared/design-system/theme/css-variables.css`
  - Do not keep as an alias after migration is complete.
- Delete after confirming no imports: `apps/web/src/shared/design-system/theme/tailwind-preset.ts`
- Delete after confirming no imports: `apps/web/src/shared/design-system/theme/index.ts`
- Delete after confirming no imports: `apps/web/src/shared/design-system/tokens/*.ts`
- Delete after confirming no imports: `apps/web/src/shared/design-system/tokens/index.ts`
- Delete or update after confirming no imports: `apps/web/src/shared/design-system/index.ts`
- Keep or update docs only if useful: `apps/web/src/shared/design-system/docs/component-guidelines.md`

### Shared UI Primitives

- Modify:
  - `apps/web/src/shared/ui/button/button.tsx`
  - `apps/web/src/shared/ui/icon-button/icon-button.tsx`
  - `apps/web/src/shared/ui/badge/badge.tsx`
  - `apps/web/src/shared/ui/status-pill/status-pill.tsx`
  - `apps/web/src/shared/ui/input/input.tsx`
  - `apps/web/src/shared/ui/select/select.tsx`
  - `apps/web/src/shared/ui/textarea/textarea.tsx`
  - `apps/web/src/shared/ui/checkbox/checkbox.tsx`
  - `apps/web/src/shared/ui/dialog/dialog.tsx`
  - `apps/web/src/shared/ui/drawer/drawer.tsx`
  - `apps/web/src/shared/ui/toast/toast.tsx`
  - `apps/web/src/shared/ui/table/table.tsx`
  - `apps/web/src/shared/ui/tabs/tabs.tsx`
  - `apps/web/src/shared/ui/empty-state/empty-state.tsx`
  - `apps/web/src/shared/ui/skeleton/skeleton.tsx`
  - `apps/web/src/shared/ui/timeline/timeline.tsx`
  - `apps/web/src/shared/ui/index.ts`
- Create:
  - `apps/web/src/shared/ui/field/field.tsx`
  - `apps/web/src/shared/ui/inline-notice/inline-notice.tsx`

### Shared Layout Primitives

- Modify:
  - `apps/web/src/shared/layout/app-shell/app-shell.tsx`
  - `apps/web/src/shared/layout/sidebar-nav/sidebar-nav.tsx`
  - `apps/web/src/shared/layout/topbar/topbar.tsx`
  - `apps/web/src/shared/layout/page-header/page-header.tsx`
  - `apps/web/src/shared/layout/section/section.tsx`
  - `apps/web/src/shared/layout/detail-layout/detail-layout.tsx`
  - `apps/web/src/shared/layout/action-rail/action-rail.tsx`
  - `apps/web/src/shared/layout/split-pane/split-pane.tsx`
  - `apps/web/src/shared/layout/index.ts`
- Create:
  - `apps/web/src/shared/layout/metric-grid/metric-grid.tsx`
  - `apps/web/src/shared/layout/inline-actions/inline-actions.tsx`
  - `apps/web/src/shared/layout/pill-group/pill-group.tsx`
  - `apps/web/src/shared/layout/metadata-grid/metadata-grid.tsx`
  - `apps/web/src/shared/layout/object-summary/object-summary.tsx`
- Modify:
  - `apps/web/src/app/routes/_layout.tsx`
  - Use existing `ProjectContext`, `ActorContext`, and `RuntimeFlags`; do not keep placeholder text such as `Product workspace`.

### Product Pages

- Modify low-risk pages first:
  - `apps/web/src/features/product-actions/product-action-list.tsx`
  - `apps/web/src/features/product-lanes/product-lane-route.tsx`
  - `apps/web/src/features/product-lanes/product-lane-table.tsx`
  - `apps/web/src/features/pipeline/pipeline-route.tsx`
  - `apps/web/src/features/work-items/work-items-list.tsx`
  - `apps/web/src/features/work-items/create-work-item-form.tsx`
  - `apps/web/src/features/work-items/intake/intake-fields.tsx`
- Modify Work Item cockpit and Spec/Plan pages:
  - `apps/web/src/features/work-items/work-item-detail.tsx`
  - `apps/web/src/features/work-items/work-item-next-actions.tsx`
  - `apps/web/src/features/work-items/delivery-cockpit/*.tsx`
  - `apps/web/src/features/spec-plan/spec-plan-work-item-flow.tsx`
  - `apps/web/src/features/spec-plan/spec-plan-direct-routes.tsx`
  - `apps/web/src/features/spec-plan/spec-plan-lifecycle-actions.tsx`
- Modify execution/review/release pages:
  - `apps/web/src/features/execution-packages/execution-package-routes.tsx`
  - `apps/web/src/features/run-console/run-console-routes.tsx`
  - `apps/web/src/features/review-packets/review-packet-routes.tsx`
  - `apps/web/src/features/review-packets/review-decision-form.tsx`
  - `apps/web/src/features/releases/release-routes.tsx`
  - `apps/web/src/features/releases/release-action-rail.tsx`
  - `apps/web/src/features/dev-tools/dev-tools-route.tsx`

### Tests

- Modify:
  - `tests/web/design-system.test.tsx`
  - `tests/web/a11y-gates.test.tsx`
  - `tests/web/responsive-layout.test.tsx`
  - `tests/web/no-legacy-web-ui.test.ts`
  - `tests/web/app-shell-routing.test.tsx`
  - `tests/web/product-lanes-route.test.tsx`
  - `tests/web/pipeline-product-route.test.tsx`
  - `tests/web/work-item-intake-form.test.tsx`
  - `tests/web/work-item-product-route.test.tsx`
  - `tests/web/work-item-delivery-cockpit.test.tsx`
  - `tests/web/spec-plan-product-route.test.tsx`
  - `tests/web/spec-plan-direct-routes.test.tsx`
  - `tests/web/package-run-product-routes.test.tsx`
  - `tests/web/review-release-product-routes.test.tsx`
  - `tests/e2e/web-product-routes.e2e.test.ts`
- Optional create if no-legacy scan becomes too large:
  - `tests/web/helpers/no-legacy-class-scan.ts`

## Implementation Rules

- Do not change backend, API, domain, database, query, or contract semantics.
- Do not add route aliases, styling aliases, compatibility CSS, old/new theme flags, or `.fl-*` replacements.
- Do not keep `fl-*` as Tailwind theme prefix. Use class names such as `bg-surface`, `text-text-primary`, `border-border`, `shadow-elevated`, `rounded-card`.
- Do not assert exact Tailwind strings in normal tests. Use role/name/text/behavior assertions. The only exact-class scan is the no-legacy test.
- Use `cn()` for class composition. Use `cva` only inside reusable primitives where variants remove meaningful duplication.
- Keep commits small enough to revert by layer.
- Run focused tests after each task; do not defer all screenshot/overflow work to the end.

## Task 0: Baseline And Safety Check

**Files:**
- Read: `docs/superpowers/specs/2026-05-22-stream-c-ui-cleanliness-closure-design.md`
- Read: `apps/web/src/shared/design-system/theme/css-variables.css`
- Read: `tests/e2e/web-product-routes.e2e.test.ts`

- [ ] **Step 1: Confirm branch and workspace**

Run:

```bash
git status --short --branch
```

Expected: branch is the implementation branch and the worktree is clean before code changes.

- [ ] **Step 2: Confirm current Web test baseline**

Run:

```bash
pnpm vitest run tests/web/design-system.test.tsx tests/web/responsive-layout.test.tsx tests/web/a11y-gates.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS on current `main`. If this fails before edits, stop and record the pre-existing failure before changing code.

- [ ] **Step 3: Confirm no product source still imports deleted design-system TS tokens outside the design-system folder**

Run:

```bash
rg -n "shared/design-system|tailwindPreset|design-system/tokens|from ['\\\"].*tokens|from ['\\\"].*design-system" apps packages tests -g '!apps/web/src/shared/design-system/**'
```

Expected: only unrelated strings or no matches. If active imports exist, include those files in Task 1.

## Task 1: Tailwind Theme And Base CSS Source Of Truth

**Files:**
- Modify: `apps/web/src/shared/design-system/theme/css-variables.css`
- Modify: `tests/web/a11y-gates.test.tsx`
- Modify: `tests/web/design-system.test.tsx`
- Delete after imports are gone: `apps/web/src/shared/design-system/theme/tailwind-preset.ts`
- Delete after imports are gone: `apps/web/src/shared/design-system/theme/index.ts`
- Delete after imports are gone: `apps/web/src/shared/design-system/tokens/colors.ts`
- Delete after imports are gone: `apps/web/src/shared/design-system/tokens/radius.ts`
- Delete after imports are gone: `apps/web/src/shared/design-system/tokens/motion.ts`
- Delete after imports are gone: `apps/web/src/shared/design-system/tokens/shadows.ts`
- Delete after imports are gone: `apps/web/src/shared/design-system/tokens/spacing.ts`
- Delete after imports are gone: `apps/web/src/shared/design-system/tokens/typography.ts`
- Delete after imports are gone: `apps/web/src/shared/design-system/tokens/zIndex.ts`
- Delete after imports are gone: `apps/web/src/shared/design-system/tokens/index.ts`
- Delete after imports are gone: `apps/web/src/shared/design-system/index.ts`

- [ ] **Step 1: Write failing theme tests**

In `tests/web/a11y-gates.test.tsx`, replace the old `--fl-color-*` token assertions with Tailwind v4 theme variable assertions. Keep reading `apps/web/src/shared/design-system/theme/css-variables.css` in this task because the final CSS entry move happens after page migration in Task 7. Use this helper shape:

```ts
function cssTokenMap(css: string) {
  return Object.fromEntries(
    [...css.matchAll(/(--(?:color|shadow|radius|font|text|spacing|z|duration|ease)-[\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  );
}
```

Assert:

```ts
expect(tokens['--color-background']).toBe('#f6f8fb');
expect(tokens['--color-surface']).toBe('#ffffff');
expect(tokens['--color-primary']).toBe('#2563eb');
expect(tokens['--z-sticky']).toBe('10');
expect(tokens['--z-overlay']).toBe('40');
expect(tokens['--z-drawer']).toBe('50');
expect(tokens['--z-modal']).toBe('60');
expect(tokens['--z-toast']).toBe('70');
expect(tokens['--duration-fast']).toBe('120ms');
expect(tokens['--duration-base']).toBe('180ms');
expect(tokens['--duration-slow']).toBe('260ms');
expect(tokens['--ease-standard']).toBe('cubic-bezier(0.2, 0, 0, 1)');
expect(tokens['--ease-out']).toBe('cubic-bezier(0, 0, 0.2, 1)');
expect(Object.keys(tokens).some((key) => key.includes('-fl-'))).toBe(false);
expect(css).toContain('@media (prefers-reduced-motion: reduce)');
expect(contrast(tokens['--color-text-primary'], tokens['--color-background'])).toBeGreaterThanOrEqual(7);
expect(contrast(tokens['--color-text-secondary'], tokens['--color-surface'])).toBeGreaterThanOrEqual(4.5);
expect(contrast('#ffffff', tokens['--color-primary'])).toBeGreaterThanOrEqual(4.5);
expect(contrast(tokens['--color-danger'], tokens['--color-danger-soft'])).toBeGreaterThanOrEqual(4.5);
expect(contrast(tokens['--color-warning'], tokens['--color-warning-soft'])).toBeGreaterThanOrEqual(4.5);
```

Do not add the final no-legacy CSS class scan in this task. Old component classes still exist until Tasks 2-6 migrate consumers. The no-legacy scan is introduced in Task 7.

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm vitest run tests/web/a11y-gates.test.tsx tests/web/design-system.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because the current CSS does not expose the neutral `--color-*` Tailwind theme variables yet.

- [ ] **Step 3: Add neutral Tailwind theme variables to the current CSS entry**

Modify the top of `apps/web/src/shared/design-system/theme/css-variables.css` so its `@theme` replaces the old `--color-fl-*`, `--radius-fl-*`, and `--shadow-fl-*` entries with the neutral tokens below. Keep the existing old `.fl-*` component/page classes and their `:root --fl-*` support variables temporarily; they will be removed after the owning primitives and pages have migrated. Do not keep `fl-*` names in Tailwind theme tokens.

```css
@import "tailwindcss";

@theme {
  --color-background: #f6f8fb;
  --color-surface: #ffffff;
  --color-surface-raised: #fbfdff;
  --color-surface-muted: #f1f5f9;
  --color-border: #d9e2ec;
  --color-border-strong: #b8c6d6;
  --color-text-primary: #0f172a;
  --color-text-secondary: #475569;
  --color-text-muted: #64748b;
  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-primary-soft: #dbeafe;
  --color-success: #15803d;
  --color-success-soft: #dcfce7;
  --color-warning: #b45309;
  --color-warning-soft: #fef3c7;
  --color-danger: #b91c1c;
  --color-danger-soft: #fee2e2;
  --color-info: #0369a1;
  --color-info-soft: #e0f2fe;
  --color-focus: #0ea5e9;
  --font-sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-card: 8px;
  --radius-pill: 999px;
  --shadow-subtle: 0 1px 2px rgb(15 23 42 / 0.06);
  --shadow-elevated: 0 8px 24px rgb(15 23 42 / 0.08);
  --shadow-overlay: 0 18px 48px rgb(15 23 42 / 0.14);
  --z-sticky: 10;
  --z-overlay: 40;
  --z-drawer: 50;
  --z-modal: 60;
  --z-toast: 70;
  --duration-fast: 120ms;
  --duration-base: 180ms;
  --duration-slow: 260ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
}

@layer base {
  * {
    box-sizing: border-box;
  }

  html {
    min-height: 100%;
    background: var(--color-background);
    color: var(--color-text-primary);
    font-family: var(--font-sans);
    line-height: 1.5;
    text-rendering: optimizeLegibility;
  }

  body {
    min-height: 100%;
    margin: 0;
    background: var(--color-background);
  }

  button,
  input,
  select,
  textarea {
    font: inherit;
  }

  button {
    cursor: pointer;
  }

  button:disabled,
  input:disabled,
  select:disabled,
  textarea:disabled {
    cursor: not-allowed;
    opacity: 0.62;
  }

  a {
    color: inherit;
  }

  :focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
    }
  }
}
```

- [ ] **Step 4: Delete unused TypeScript token/preset files**

Run the import scan from Task 0 first. If it confirms no active imports, delete the TypeScript token and preset files listed above. Do not keep re-export aliases.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm vitest run tests/web/a11y-gates.test.tsx tests/web/design-system.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS for updated token and base CSS tests.

- [ ] **Step 6: Run Web typecheck**

Run:

```bash
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS. If deletions broke imports, fix imports by removing dead design-system references, not by recreating aliases.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/shared/design-system tests/web/a11y-gates.test.tsx tests/web/design-system.test.tsx
git commit -m "refactor(web): establish tailwind theme tokens"
```

## Task 2: Tailwind-First Shared UI Primitives

**Files:**
- Modify: all files under `apps/web/src/shared/ui/**`
- Create: `apps/web/src/shared/ui/field/field.tsx`
- Create: `apps/web/src/shared/ui/inline-notice/inline-notice.tsx`
- Modify: `tests/web/design-system.test.tsx`
- Modify: `tests/web/a11y-gates.test.tsx` if axe/focus expectations need updates

- [ ] **Step 1: Write failing primitive tests**

In `tests/web/design-system.test.tsx`, update tests to assert semantics instead of `.fl-*` classes.

Add tests for:

```tsx
render(<Button iconLeading={<span aria-hidden="true">+</span>}>Create Spec</Button>);
expect(screen.getByRole('button', { name: 'Create Spec' })).toBeTruthy();
expect(document.body.innerHTML).not.toContain('fl-button');

render(<Button loading>Create Spec</Button>);
expect(screen.getByRole('button', { name: 'Loading Create Spec' }).hasAttribute('disabled')).toBe(true);
```

Add tests for new primitives:

```tsx
render(<InlineNotice tone="warning" title="Runtime blocked" description="Worker is unavailable." />);
expect(screen.getByRole('status', { name: 'Runtime blocked' })).toBeTruthy();

render(<Field label="Review summary" error="Summary is required"><Input aria-label="Review summary input" /></Field>);
expect(screen.getByText('Summary is required').getAttribute('role')).toBe('alert');

render(<Input aria-label="Title" invalid disabled />);
const input = screen.getByLabelText('Title');
expect(input.hasAttribute('disabled')).toBe(true);
expect(input.getAttribute('aria-invalid')).toBe('true');

render(<Skeleton lines={2} />);
expect(document.querySelector('[aria-hidden="true"]')).not.toBeNull();
expect(document.querySelectorAll('[data-skeleton-line]').length).toBe(2);
```

Keep existing Dialog, Drawer, Toast, and Section tests, but rewrite them away from `.fl-*` selectors:

```tsx
render(<Section title="Release scope">Content</Section>);
expect(screen.getByRole('heading', { name: 'Release scope' })).toBeTruthy();
expect(document.querySelector('.fl-section, .fl-card .fl-card, .card .card')).toBeNull();
```

Also assert no `fl-dialog`, `fl-drawer`, or `fl-toast` appears in `document.body.innerHTML`.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm vitest run tests/web/design-system.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because primitives still emit `.fl-*` classes and `Field` / `InlineNotice` do not exist.

- [ ] **Step 3: Convert `Button` and `IconButton`**

Use `cva` in `apps/web/src/shared/ui/button/button.tsx`:

```ts
const buttonClasses = cva(
  'inline-flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      variant: {
        primary: 'border-transparent bg-primary text-white hover:not-disabled:bg-primary-hover',
        secondary: 'border-border bg-surface text-text-primary hover:not-disabled:border-border-strong hover:not-disabled:bg-surface-muted',
        ghost: 'border-transparent bg-transparent text-text-secondary hover:not-disabled:bg-surface-muted hover:not-disabled:text-text-primary',
        danger: 'border-transparent bg-danger text-white hover:not-disabled:bg-red-700',
      },
      size: {
        sm: 'min-h-8 px-3 text-xs',
        md: 'min-h-10 px-4 text-sm',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);
```

Use similar Tailwind utilities in `IconButton`; it must still require `label` and set `aria-label`.

- [ ] **Step 4: Convert display and form primitives**

Convert these files to Tailwind utilities and no `.fl-*` output:

- `badge/badge.tsx`
- `status-pill/status-pill.tsx`
- `input/input.tsx`
- `select/select.tsx`
- `textarea/textarea.tsx`
- `checkbox/checkbox.tsx`
- `empty-state/empty-state.tsx`
- `skeleton/skeleton.tsx`
- `tabs/tabs.tsx`
- `timeline/timeline.tsx`

`Skeleton` should keep the group `aria-hidden="true"` and put `data-skeleton-line` on each rendered placeholder line so tests can verify line count without asserting exact Tailwind class strings. Reduced-motion behavior is covered by the base CSS test from Task 1.

Status color mapping should use theme classes:

```ts
const toneClasses = {
  neutral: 'bg-surface-muted text-text-secondary',
  primary: 'bg-primary-soft text-primary-hover',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
} as const;
```

- [ ] **Step 5: Create `Field`**

Create `apps/web/src/shared/ui/field/field.tsx`:

```tsx
import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface FieldProps {
  children: ReactNode;
  error?: ReactNode;
  hint?: ReactNode;
  label: ReactNode;
  required?: boolean;
  className?: string;
}

export function Field({ children, className, error, hint, label, required = false }: FieldProps) {
  return (
    <label className={cn('grid gap-2 text-sm font-semibold text-text-secondary', className)}>
      <span className="flex items-center gap-1">
        <span>{label}</span>
        {required ? <span aria-hidden="true" className="text-danger">*</span> : null}
      </span>
      {children}
      {hint ? <span className="text-xs font-normal text-text-muted">{hint}</span> : null}
      {error ? <span className="text-xs font-semibold text-danger" role="alert">{error}</span> : null}
    </label>
  );
}
```

- [ ] **Step 6: Create `InlineNotice`**

Create `apps/web/src/shared/ui/inline-notice/inline-notice.tsx`:

```tsx
import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

type NoticeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const toneClasses = {
  neutral: 'border-border bg-surface-muted text-text-secondary',
  info: 'border-info/30 bg-info-soft text-info',
  success: 'border-success/30 bg-success-soft text-success',
  warning: 'border-warning/30 bg-warning-soft text-warning',
  danger: 'border-danger/30 bg-danger-soft text-danger',
} satisfies Record<NoticeTone, string>;

export interface InlineNoticeProps extends HTMLAttributes<HTMLDivElement> {
  actions?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
  tone?: NoticeTone;
}

export function InlineNotice({ actions, className, description, title, tone = 'neutral', ...props }: InlineNoticeProps) {
  return (
    <div
      {...props}
      aria-label={typeof title === 'string' ? title : undefined}
      className={cn('grid gap-2 rounded-card border p-3 text-sm', toneClasses[tone], className)}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <div className="font-semibold">{title}</div>
      {description ? <div className="text-current/80">{description}</div> : null}
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
```

- [ ] **Step 7: Convert Radix primitives**

Convert `dialog`, `drawer`, and `toast` internals to Tailwind utilities. Do not define global Radix classes. Keep `DialogClose`, `DrawerClose`, `ToastAction`, and `ToastClose` accessible names.

- [ ] **Step 8: Convert table primitive**

Update `DataTable` so desktop table and mobile card fallback use Tailwind utilities and keep `data-responsive-card-list`. Do not use `.empty` for empty messages.

- [ ] **Step 9: Export new primitives**

Update `apps/web/src/shared/ui/index.ts` to export `Field` and `InlineNotice`.

- [ ] **Step 10: Run focused tests**

Run:

```bash
pnpm vitest run tests/web/design-system.test.tsx tests/web/a11y-gates.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 11: Run typecheck**

Run:

```bash
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/shared/ui tests/web/design-system.test.tsx tests/web/a11y-gates.test.tsx
git commit -m "refactor(web): convert ui primitives to tailwind"
```

## Task 3: Tailwind-First Layout Primitives And Product Shell

**Files:**
- Modify: `apps/web/src/shared/layout/**/*.tsx`
- Create: `apps/web/src/shared/layout/metric-grid/metric-grid.tsx`
- Create: `apps/web/src/shared/layout/inline-actions/inline-actions.tsx`
- Create: `apps/web/src/shared/layout/pill-group/pill-group.tsx`
- Create: `apps/web/src/shared/layout/metadata-grid/metadata-grid.tsx`
- Create: `apps/web/src/shared/layout/object-summary/object-summary.tsx`
- Modify: `apps/web/src/app/routes/_layout.tsx`
- Modify: `tests/web/responsive-layout.test.tsx`
- Modify: `tests/web/app-shell-routing.test.tsx`
- Modify: `tests/web/design-system.test.tsx`

- [ ] **Step 1: Write failing layout tests**

In `tests/web/responsive-layout.test.tsx`, remove CSS-string assertions for `.fl-detail-layout__body` and `.fl-action-rail`.

Assert behavior instead:

```ts
expect(screen.getByRole('banner')).toBeTruthy();
expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy();
expect(screen.getByRole('main')).toBeTruthy();
expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
expect(document.body.innerHTML).not.toContain('fl-app-shell');
```

In `tests/web/app-shell-routing.test.tsx`, assert the topbar shows real context:

```ts
expect(screen.getByText('project-web-product')).toBeTruthy();
expect(screen.getByText('actor-owner')).toBeTruthy();
expect(screen.queryByText('Product workspace')).toBeNull();
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm vitest run tests/web/responsive-layout.test.tsx tests/web/app-shell-routing.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because layout primitives still emit `.fl-*` classes and topbar still says `Product workspace`.

- [ ] **Step 3: Convert existing layout primitives**

Convert `AppShell`, `SidebarNav`, `Topbar`, `PageHeader`, `Section`, `DetailLayout`, `ActionRail`, and `SplitPane` to Tailwind utilities. Keep semantics:

- `AppShell` still renders a skip link to `#main-content`.
- Sidebar `aside` keeps `aria-label="Primary navigation"`.
- Topbar stays inside `header` / banner.
- Main keeps `id="main-content"` and `tabIndex={-1}`.
- Mobile nav trigger remains a button with `aria-controls` and `aria-expanded`.

- [ ] **Step 4: Add layout primitives**

Create the new layout primitives with Tailwind utility classes:

- `MetricGrid` and `Metric`: render semantic `dl`, `dt`, `dd`.
- `InlineActions`: flex-wrap action group.
- `PillGroup`: flex-wrap badge/status group.
- `MetadataGrid`: semantic `dl` for object metadata.
- `ObjectSummary`: compact title/subtitle/meta wrapper.

`MetricGrid` example:

```tsx
export function MetricGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}>{children}</dl>;
}
```

- [ ] **Step 5: Export layout primitives**

Update `apps/web/src/shared/layout/index.ts`.

- [ ] **Step 6: Replace topbar placeholder**

Modify `apps/web/src/app/routes/_layout.tsx` to use real contexts. The current safe layout-level contexts are `ProjectContext`, `ActorContext`, and `RuntimeFlags.devToolsEnabled`; there is no global durability status source at this layer. Do not invent one or display filler status copy. Render project and actor context, render Dev Tools visibility only from `RuntimeFlags`, and omit the runtime/durability slot until a product-safe read model exists.

```tsx
const { projectId } = useProjectContext();
const { actorId } = useActorContext();

topbar={
  <Topbar
    projectId={projectId}
    actorId={actorId}
    devToolsEnabled={runtimeFlags.devToolsEnabled}
  />
}
```

Adjust `TopbarProps` accordingly. If `Topbar` remains generic, pass explicit `children` with project/actor labels, but do not use placeholder copy.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm vitest run tests/web/responsive-layout.test.tsx tests/web/app-shell-routing.test.tsx tests/web/design-system.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 8: Run typecheck**

Run:

```bash
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/shared/layout apps/web/src/app/routes/_layout.tsx tests/web/responsive-layout.test.tsx tests/web/app-shell-routing.test.tsx tests/web/design-system.test.tsx
git commit -m "refactor(web): convert layout primitives to tailwind"
```

## Task 4: Migrate Product Lanes, Pipeline, Work Items, And Product Actions

**Files:**
- Modify: `apps/web/src/features/product-actions/product-action-list.tsx`
- Modify: `apps/web/src/features/product-lanes/product-lane-route.tsx`
- Modify: `apps/web/src/features/product-lanes/product-lane-table.tsx`
- Modify: `apps/web/src/features/pipeline/pipeline-route.tsx`
- Modify: `apps/web/src/features/work-items/work-items-list.tsx`
- Modify: `apps/web/src/features/work-items/create-work-item-form.tsx`
- Modify: `apps/web/src/features/work-items/intake/intake-fields.tsx`
- Modify: `tests/web/product-lanes-route.test.tsx`
- Modify: `tests/web/pipeline-product-route.test.tsx`
- Modify: `tests/web/work-item-intake-form.test.tsx`
- Modify: `tests/web/work-item-product-route.test.tsx`
- Create or update: `tests/web/helpers/no-legacy-class-scan.ts`

- [ ] **Step 1: Write failing route assertions**

Create the initial rendered-DOM helper in `tests/web/helpers/no-legacy-class-scan.ts` and use it from focused route tests so the forbidden-token list lives in one helper instead of being duplicated across product tests:

```ts
const forbiddenClassTokens = [
  /^fl-/,
  /^empty$/,
  /^metric$/,
  /^pill-list$/,
  /^state-grid$/,
  /^form-grid$/,
  /^button-row$/,
  /^danger-text$/,
  /^timeline-list$/,
  /^timeline-entry$/,
];

export function legacyRenderedClassTokens(root: ParentNode) {
  return [...root.querySelectorAll<HTMLElement>('[class]')].flatMap((element) =>
    [...element.classList].filter((token) => isForbiddenLegacyClassToken(token)),
  );
}

function isForbiddenLegacyClassToken(token: string) {
  return forbiddenClassTokens.some((forbidden) => forbidden.test((token.split(':').at(-1) ?? token).replace(/^!/, '')));
}
```

In each route test, assert after rendering:

```ts
expect(legacyRenderedClassTokens(document.body)).toEqual([]);
```

Add this assertion to:

- `/lanes`
- `/pipeline`
- `/work-items`
- `/work-items/new`

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
pnpm vitest run tests/web/product-lanes-route.test.tsx tests/web/pipeline-product-route.test.tsx tests/web/work-item-intake-form.test.tsx tests/web/work-item-product-route.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because these pages still use old classes.

- [ ] **Step 3: Migrate ProductActionList**

Use `Button`, `InlineNotice`, `InlineActions`, and plain Tailwind layout. Replace `.empty` with `InlineNotice` or plain text with Tailwind classes.

- [ ] **Step 4: Migrate Product Lanes**

Use:

- `InlineActions` or tabs for lane switcher.
- `MetricGrid` / `Metric` for summary.
- `PillGroup` for selected item state.
- `DataTable` with Tailwind implementation.

Do not change lane query behavior.

- [ ] **Step 5: Migrate Pipeline**

Extract local components if helpful inside `pipeline-route.tsx`:

- `PipelineStageCard`
- `PipelineStageMetric`
- `PipelineStageDetails`

Use Tailwind utilities inside those components. Do not recreate `.fl-pipeline-*`.

- [ ] **Step 6: Migrate Work Items list and typed intake**

Use `Field` in `create-work-item-form.tsx` and `intake-fields.tsx`. Replace:

- `.state-grid` -> `MetricGrid`
- `.form-grid two` -> Tailwind grid utilities or a small local `FormGrid`
- `.button-row` -> `InlineActions`
- `.danger-text` -> `Field` error or `InlineNotice tone="danger"`

Do not change intake payload normalization or Driver semantics.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm vitest run tests/web/product-lanes-route.test.tsx tests/web/pipeline-product-route.test.tsx tests/web/work-item-intake-form.test.tsx tests/web/work-item-product-route.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 8: Run typecheck**

Run:

```bash
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/product-actions apps/web/src/features/product-lanes apps/web/src/features/pipeline apps/web/src/features/work-items tests/web/helpers/no-legacy-class-scan.ts tests/web/product-lanes-route.test.tsx tests/web/pipeline-product-route.test.tsx tests/web/work-item-intake-form.test.tsx tests/web/work-item-product-route.test.tsx
git commit -m "refactor(web): migrate lane pipeline and intake pages"
```

## Task 5: Migrate Work Item Cockpit And Spec/Plan Pages

**Files:**
- Modify: `apps/web/src/features/work-items/work-item-detail.tsx`
- Modify: `apps/web/src/features/work-items/work-item-next-actions.tsx`
- Modify: `apps/web/src/features/work-items/delivery-cockpit/action-rail.tsx`
- Modify: `apps/web/src/features/work-items/delivery-cockpit/action-summary.tsx`
- Modify: `apps/web/src/features/work-items/delivery-cockpit/evidence-timeline.tsx`
- Modify: `apps/web/src/features/work-items/delivery-cockpit/execution-summary.tsx`
- Modify: `apps/web/src/features/work-items/delivery-cockpit/initiative-breakdown.tsx`
- Modify: `apps/web/src/features/work-items/delivery-cockpit/integration-readiness-panel.tsx`
- Modify: `apps/web/src/features/work-items/delivery-cockpit/package-matrix.tsx`
- Modify: `apps/web/src/features/work-items/delivery-cockpit/quality-gate-panel.tsx`
- Modify: `apps/web/src/features/work-items/delivery-cockpit/release-readiness-panel.tsx`
- Modify: `apps/web/src/features/work-items/delivery-cockpit/review-summary.tsx`
- Modify: `apps/web/src/features/work-items/delivery-cockpit/stage-rail.tsx`
- Modify: `apps/web/src/features/work-items/delivery-cockpit/typed-brief.tsx`
- Modify: `apps/web/src/features/spec-plan/spec-plan-work-item-flow.tsx`
- Modify: `apps/web/src/features/spec-plan/spec-plan-direct-routes.tsx`
- Modify: `apps/web/src/features/spec-plan/spec-plan-lifecycle-actions.tsx`
- Modify: `tests/web/work-item-delivery-cockpit.test.tsx`
- Modify: `tests/web/spec-plan-product-route.test.tsx`
- Modify: `tests/web/spec-plan-direct-routes.test.tsx`
- Modify: `tests/web/spec-plan-lifecycle-actions.test.tsx`

- [ ] **Step 1: Write failing route assertions**

Add no-legacy rendered class assertions to:

- `/work-items/wi-1`
- `/work-items/wi-1/spec-plan`
- `/specs`
- `/specs/:specId`
- `/plans`
- `/plans/:planId`

Use the same `legacyRenderedClassTokens(document.body)` helper from Task 4. Do not duplicate forbidden-token regexes in these route test files.

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
pnpm vitest run tests/web/work-item-delivery-cockpit.test.tsx tests/web/spec-plan-product-route.test.tsx tests/web/spec-plan-direct-routes.test.tsx tests/web/spec-plan-lifecycle-actions.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because these routes still render old classes.

- [ ] **Step 3: Migrate Work Item cockpit summary and panels**

Replace:

- `.state-grid` / `.metric` -> `MetricGrid` / `Metric`
- `.pill-list` -> `PillGroup` or `InlineActions`
- `.empty` -> `InlineNotice`, `EmptyState`, or Tailwind text
- `.timeline-list` / `.timeline-entry` -> `Timeline`

Do not add new typed brief data semantics. Only visually compose existing `workItem.intake_context`, readiness, evidence, and replay data.

- [ ] **Step 4: Migrate Work Item cockpit Action Rail**

Use shared `ActionRail`, `InlineNotice`, and `Button`. Preserve existing command behavior and cache invalidation. Do not move high-risk object-page decisions into the Work Item cockpit.

- [ ] **Step 5: Migrate Spec/Plan pages**

Replace repeated artifact summary, revision list, replay/timeline, lifecycle action, filter, and package generation callout markup with shared primitives. Use tabs or segmented controls for status filters instead of pill-like class links.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm vitest run tests/web/work-item-delivery-cockpit.test.tsx tests/web/spec-plan-product-route.test.tsx tests/web/spec-plan-direct-routes.test.tsx tests/web/spec-plan-lifecycle-actions.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run:

```bash
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/work-items apps/web/src/features/spec-plan tests/web/work-item-delivery-cockpit.test.tsx tests/web/spec-plan-product-route.test.tsx tests/web/spec-plan-direct-routes.test.tsx tests/web/spec-plan-lifecycle-actions.test.tsx
git commit -m "refactor(web): migrate cockpit and spec plan pages"
```

## Task 6: Migrate Package, Run, Review, Release, And Dev Tools Pages

**Files:**
- Modify: `apps/web/src/features/execution-packages/execution-package-routes.tsx`
- Modify: `apps/web/src/features/run-console/run-console-routes.tsx`
- Modify: `apps/web/src/features/review-packets/review-packet-routes.tsx`
- Modify: `apps/web/src/features/review-packets/review-decision-form.tsx`
- Modify: `apps/web/src/features/releases/release-routes.tsx`
- Modify: `apps/web/src/features/releases/release-action-rail.tsx`
- Modify: `apps/web/src/features/dev-tools/dev-tools-route.tsx`
- Modify: `tests/web/package-run-product-routes.test.tsx`
- Modify: `tests/web/review-release-product-routes.test.tsx`
- Modify: `tests/web/dev-tools-gating.test.tsx`
- Modify: `tests/web/release-owner-surface.test.tsx`
- Modify: `tests/web/helpers/no-legacy-class-scan.ts`

- [ ] **Step 1: Write failing route assertions**

Add no-legacy rendered class assertions to:

- `/packages`
- `/packages/:packageId`
- `/runs`
- `/runs/:runSessionId`
- `/reviews`
- `/reviews/:reviewPacketId`
- `/releases`
- `/releases/:releaseId`
- `/dev-tools` when enabled in the dev-tools test harness

Use the same `legacyRenderedClassTokens(document.body)` helper from Task 4. Do not duplicate forbidden-token regexes in these route test files.

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
pnpm vitest run tests/web/package-run-product-routes.test.tsx tests/web/review-release-product-routes.test.tsx tests/web/dev-tools-gating.test.tsx tests/web/release-owner-surface.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because these routes still render old classes.

- [ ] **Step 3: Migrate package routes**

Use `MetadataGrid`, `PillGroup`, `InlineActions`, `InlineNotice`, `Tabs`, `DataTable`, and shared `ActionRail`. Preserve package action model behavior.

If `execution-package-routes.tsx` remains too large after migration, split only visual subcomponents into files under `apps/web/src/features/execution-packages/`, for example:

- `package-detail-panels.tsx`
- `package-registry-table.tsx`

Do not split domain/action model code in this task.

- [ ] **Step 4: Migrate Run Console**

Keep the console-like event stream but implement it with local Tailwind classes. Replace:

- `.fl-run-console`
- `.fl-run-console__controls`
- `.fl-run-console__actions`
- `.fl-run-console__events`
- `.fl-run-console__event`

Keep existing stream, backfill, operator input, cancel, resume, and route behavior.

- [ ] **Step 5: Migrate review routes and decision form**

Use `Field`, `InlineNotice`, `InlineActions`, `PillGroup`, and `MetadataGrid`. Preserve validation and mutation behavior.

- [ ] **Step 6: Migrate release routes and action rail**

Use shared `ActionRail`, `Field`, `InlineNotice`, `Drawer`, `Dialog`, `MetadataGrid`, and `PillGroup`. Preserve release action model behavior and high-risk action confirmations.

- [ ] **Step 7: Migrate Dev Tools visually**

Keep Dev Tools gated. Use shared primitives and Tailwind utilities. Do not make Dev Tools visible in product navigation unless `RuntimeFlags.devToolsEnabled` is true.

- [ ] **Step 8: Run focused tests**

Run:

```bash
pnpm vitest run tests/web/package-run-product-routes.test.tsx tests/web/review-release-product-routes.test.tsx tests/web/dev-tools-gating.test.tsx tests/web/release-owner-surface.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 9: Run typecheck**

Run:

```bash
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/features/execution-packages apps/web/src/features/run-console apps/web/src/features/review-packets apps/web/src/features/releases apps/web/src/features/dev-tools tests/web/package-run-product-routes.test.tsx tests/web/review-release-product-routes.test.tsx tests/web/dev-tools-gating.test.tsx tests/web/release-owner-surface.test.tsx
git commit -m "refactor(web): migrate delivery object pages"
```

## Task 7: Token-Aware No-Legacy Scan And Broad Web Test Rewrite

**Files:**
- Modify: `tests/web/no-legacy-web-ui.test.ts`
- Modify: all Web tests that still query `.fl-*` or old class names
- Optional create: `tests/web/helpers/no-legacy-class-scan.ts`
- Create: `apps/web/src/shared/styles/theme.css`
- Modify: `apps/web/src/app/root.tsx`
- Delete: `apps/web/src/shared/design-system/theme/css-variables.css`

- [ ] **Step 1: Move the final CSS entry to the non-legacy path**

Create `apps/web/src/shared/styles/theme.css` from the surviving narrow content in `apps/web/src/shared/design-system/theme/css-variables.css`. The final file must contain only:

- `@import "tailwindcss"`;
- `@theme`;
- `@layer base`;
- base reduced-motion/focus/body rules.

It must not contain `.fl-*`, `.empty`, `.metric`, `.pill-list`, `.state-grid`, `.form-grid`, `.button-row`, `.danger-text`, `.timeline-list`, `.timeline-entry`, or page-specific classes.

Update `apps/web/src/app/root.tsx`:

```ts
import '../shared/styles/theme.css';
```

Remove:

```ts
import '../shared/design-system/theme/css-variables.css';
```

Delete `apps/web/src/shared/design-system/theme/css-variables.css`. Do not leave a forwarding import or alias file.

- [ ] **Step 2: Write AST-backed token-aware no-legacy scanner**

Update `tests/web/helpers/no-legacy-class-scan.ts` so it keeps the rendered-DOM helper from Task 4 and adds an AST-backed source scanner. It must catch old class tokens in plain JSX attributes, conditional `className={condition ? 'metric' : ...}` expressions, `cn()` / `clsx()` composition, `cva()` base and variant objects, class/className props, class-map variables such as `toneClasses`, query selector assertions, and active CSS selectors. Do not implement this as only a regex over complete lines.

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const forbiddenClassTokens: RegExp[] = [
  /^fl-/,
  /^empty$/,
  /^metric$/,
  /^pill-list$/,
  /^state-grid$/,
  /^form-grid$/,
  /^button-row$/,
  /^danger-text$/,
  /^timeline-list$/,
  /^timeline-entry$/,
];

const scanRoots = ['apps/web/src', 'tests/web', 'tests/e2e'];

export function legacyRenderedClassTokens(root: ParentNode) {
  return [...root.querySelectorAll<HTMLElement>('[class]')].flatMap((element) =>
    [...element.classList].filter(isForbiddenLegacyClassToken),
  );
}

export function legacyClassTokenMatches() {
  return scanRoots
    .flatMap(textFiles)
    .filter((file) => !file.endsWith('no-legacy-web-ui.test.ts'))
    .filter((file) => !file.endsWith('helpers/no-legacy-class-scan.ts'))
    .flatMap((file) => forbiddenClassTokenMatches(file, readFileSync(file, 'utf8')));
}

export function forbiddenClassTokenMatches(file: string, source: string): string[] {
  return file.endsWith('.css') ? cssForbiddenTokenMatches(file, source) : tsForbiddenTokenMatches(file, source);
}

function textFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (path.includes('.react-router') || path.includes('/dist/') || path.includes('/node_modules/')) return [];
    if (statSync(path).isDirectory()) return textFiles(path);
    return /\.(ts|tsx|css|html)$/.test(path) ? [path] : [];
  });
}

function tsForbiddenTokenMatches(file: string, source: string) {
  const matches: string[] = [];
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function visit(node: ts.Node) {
    if (isClassSurface(node, sourceFile)) {
      collectStringValues(node).forEach((value) => pushForbiddenTokens(file, value, matches));
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return matches;
}

function isClassSurface(node: ts.Node, sourceFile: ts.SourceFile) {
  if (ts.isJsxAttribute(node)) {
    const name = node.name.getText(sourceFile);
    return name === 'className' || name === 'class';
  }
  if (ts.isPropertyAssignment(node)) {
    const name = propertyNameText(node.name);
    return name === 'className' || name === 'class';
  }
  if (ts.isVariableDeclaration(node)) {
    return /classes?|className/i.test(node.name.getText(sourceFile));
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression.getText(sourceFile).split('.').at(-1);
    return callee === 'cn' || callee === 'clsx' || callee === 'cva' || callee === 'querySelector' || callee === 'querySelectorAll';
  }
  return false;
}

function collectStringValues(node: ts.Node) {
  const values: string[] = [];

  function visit(child: ts.Node) {
    if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) {
      values.push(child.text);
      return;
    }
    if (ts.isTemplateExpression(child)) {
      values.push(child.head.text);
      child.templateSpans.forEach((span) => values.push(span.literal.text));
    }
    ts.forEachChild(child, visit);
  }

  visit(node);
  return values;
}

function cssForbiddenTokenMatches(file: string, source: string) {
  const matches: string[] = [];
  for (const match of source.matchAll(/\.([A-Za-z][\w-]*)\b/g)) {
    pushForbiddenTokens(file, match[1] ?? '', matches);
  }
  return matches;
}

function pushForbiddenTokens(file: string, value: string, matches: string[]) {
  for (const token of classTokens(value)) {
    if (isForbiddenLegacyClassToken(token)) {
      matches.push(`${file}: ${token}`);
    }
  }
}

function isForbiddenLegacyClassToken(token: string) {
  return forbiddenClassTokens.some((forbidden) => forbidden.test(classTokenBase(token)));
}

function classTokens(value: string): string[] {
  return value
    .split(/[\s"'`,()[\]{}]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.replace(/^[.#]/, ''))
    .map(classTokenBase);
}

function classTokenBase(token: string) {
  return (token.split(':').at(-1) ?? token).replace(/^!/, '');
}

function propertyNameText(name: ts.PropertyName) {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}
```

Adjust the implementation as needed for TypeScript parsing limitations, but keep the acceptance criteria: conditional class expressions and `cva()` variant objects must be scanned by traversing AST descendants, not by matching a single `className="..."` string. Do not reject `MetricGrid`, `emptyMessage`, Tailwind variants such as `empty:hidden`, or normal copy.

- [ ] **Step 3: Add no-legacy visual class test**

In `tests/web/no-legacy-web-ui.test.ts`, add:

```ts
it('does not use old global visual class tokens on active Web surfaces', () => {
  expect(legacyClassTokenMatches()).toEqual([]);
});
```

The file set must cover `apps/web/src`, `tests/web`, and `tests/e2e`, excluding generated output, screenshot artifacts, docs, and fixture data that do not define rendered class names.

- [ ] **Step 4: Run no-legacy test to verify failure or pass**

Run:

```bash
pnpm vitest run tests/web/no-legacy-web-ui.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected:

- If any old class token remains, FAIL with exact file/token.
- After all migrations above are complete, PASS.

- [ ] **Step 5: Remove remaining old visual class usage**

Run:

```bash
rg -n "fl-|\\bempty\\b|\\bmetric\\b|pill-list|state-grid|form-grid|button-row|danger-text|timeline-list|timeline-entry" apps/web/src tests/web tests/e2e
```

Expected: no active rendered class usage. Matches in the no-legacy test/helper forbidden-token list are allowed; normal identifiers such as `MetricGrid`, `emptyMessage`, and non-rendered prose can be ignored only after the AST-backed test also passes.

Fix every active match. Do not silence the scanner with exceptions for product code.

- [ ] **Step 6: Rewrite class-selector tests**

Search:

```bash
rg -n "querySelector|querySelectorAll|\\.fl-|fl-" tests/web tests/e2e
```

Rewrite tests to use:

- `getByRole`
- `findByRole`
- `getByText`
- `queryByText`
- visible route content assertions
- `data-testid` only for non-semantic streams such as run events

- [ ] **Step 7: Run all Web tests**

Run:

```bash
pnpm vitest run tests/web --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 8: Run Web build**

Run:

```bash
pnpm --filter @forgeloop/web build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src tests/web tests/e2e
git commit -m "test(web): enforce tailwind visual cleanup"
```

## Task 8: Route Visual Smoke, Screenshot Review, And Final Verification

**Files:**
- Modify if needed: `tests/e2e/web-product-routes.e2e.test.ts`
- Modify if visual fixes are found: any Web page or primitive file touched by previous tasks
- Generated artifact path: `test-results/web-product-routes/`

- [ ] **Step 1: Verify visual-smoke harness details**

Confirm `tests/e2e/web-product-routes.e2e.test.ts` still:

- starts the product API mock;
- starts React Router Web with `VITE_FORGELOOP_API_URL`;
- exercises populated and degraded routes;
- checks overflow by comparing `scrollWidth` and `clientWidth`;
- captures screenshots for 375, 768, 1024, and 1440 px;
- writes screenshots under `test-results/web-product-routes/populated/` and `test-results/web-product-routes/degraded/`.

- [ ] **Step 2: Run route visual smoke**

Run:

```bash
pnpm vitest run tests/e2e/web-product-routes.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS. If it fails with overflow, use the failure message's route and viewport to fix layout.

- [ ] **Step 3: Inspect screenshots**

Open or inspect representative screenshots under:

```text
test-results/web-product-routes/populated/
test-results/web-product-routes/degraded/
```

Check at least these routes at 375, 768, 1024, and 1440 px:

- `lanes-375.png`
- `pipeline-375.png`
- `work-items_wi-1-375.png`
- `packages_package-web-product-1024.png`
- `runs_run-web-product-1024.png`
- `reviews_review-web-product-1440.png`
- `releases_release-web-product-1440.png`

Review both `test-results/web-product-routes/populated/` and `test-results/web-product-routes/degraded/` for every representative route and every listed viewport. Do not review only the populated screenshots or only one width per route.

Expected: no horizontal overflow, no overlapping controls, no stale debug/Workbench visual language, no card-in-card composition, and usable Action Rail placement.

- [ ] **Step 4: Fix visual issues found in screenshots**

If screenshots reveal issues, edit the smallest owning primitive or page component. Do not reintroduce global CSS classes.

- [ ] **Step 5: Re-run route visual smoke after any visual fix**

Run:

```bash
pnpm vitest run tests/e2e/web-product-routes.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 6: Run Web typecheck**

Run:

```bash
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Run Web build**

Run:

```bash
pnpm --filter @forgeloop/web build
```

Expected: PASS.

- [ ] **Step 8: Run Web test suite**

Run:

```bash
pnpm vitest run tests/web --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 9: Run full workspace test**

Run:

```bash
pnpm test
```

Expected: PASS or only documented unrelated pre-existing failures. Do not claim completion if this command was skipped.

- [ ] **Step 10: Run full workspace build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 11: Final no-legacy scans**

Run:

```bash
pnpm vitest run tests/web/no-legacy-web-ui.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
rg -n "fl-|className=\\\"empty\\\"|className=\\\"metric\\\"|pill-list|state-grid|form-grid|button-row|danger-text|timeline-list|timeline-entry" apps/web/src tests/web tests/e2e
```

Expected: the test passes. The `rg` command may only show the no-legacy test definitions or documentation comments, not active rendered class usage.

- [ ] **Step 12: Commit final visual QA fixes**

If Task 8 changed files:

```bash
git add apps/web tests
git commit -m "fix(web): close visual qa issues"
```

If no files changed, do not create an empty commit.

## Final Delivery Checklist

- [ ] `pnpm --filter @forgeloop/web typecheck` passes.
- [ ] `pnpm --filter @forgeloop/web build` passes.
- [ ] `pnpm vitest run tests/web --pool=forks --no-file-parallelism --maxWorkers=1` passes.
- [ ] `pnpm vitest run tests/e2e/web-product-routes.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1` passes.
- [ ] `pnpm test` passes or only unrelated pre-existing failures are documented.
- [ ] `pnpm build` passes.
- [ ] Screenshot artifacts under `test-results/web-product-routes/` have been reviewed.
- [ ] `apps/web/src` does not use old global visual class tokens.
- [ ] Product copy does not reintroduce Workbench or coarse Work Item Owner vocabulary.
- [ ] No compatibility CSS, route alias, theme flag, or `.fl-*` Tailwind prefix remains.
