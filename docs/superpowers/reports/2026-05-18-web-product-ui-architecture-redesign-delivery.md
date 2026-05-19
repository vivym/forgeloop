# Web Product UI Architecture Redesign Delivery

- Source spec: `docs/superpowers/specs/2026-05-18-web-product-ui-architecture-redesign-design.md`
- Source plan: `docs/superpowers/plans/2026-05-18-web-product-ui-architecture-redesign.md`
- Final branch: `feature/web-product-ui-architecture-redesign-impl`

## Implementation Summary

- React Router Framework Mode is the only Web runtime and route entry.
- Product routes cover Workbench, Pipeline, Work Items, Specs, Plans, Packages, Runs, Reviews, Releases, and gated Dev Tools.
- Pipeline shows the PRD delivery loop across Intake, Spec / Plan, Execution, Review, Integration Validation, Test Acceptance, Release, and Observation.
- Release surfaces include release inventory, cockpit governance actions, scope management, and Test Acceptance acknowledgement outside Dev Tools.
- Dev Tools raw/debug controls remain gated behind the runtime flag and are absent from product routes.
- Old Web workbench files, API shims, state helpers, stylesheet, and historical UI tests were removed.

## Verification

- `pnpm --filter @forgeloop/web typecheck`: passed.
- `pnpm --filter @forgeloop/web build`: passed.
- `pnpm vitest run tests/web --pool=forks --no-file-parallelism --maxWorkers=1`: passed, 16 files / 120 tests.
- `pnpm e2e:run-console`: passed, 1 file / 1 test.
- `pnpm vitest run tests/e2e/web-product-routes.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`: passed, 1 file / 2 tests.
- `pnpm vitest run tests/api/query-module.test.ts tests/api/role-workbenches.test.ts tests/api/release-module.test.ts tests/api/test-acceptance-gate.test.ts tests/api/work-items.test.ts tests/api/spec-plan-service.test.ts tests/api/execution-package-service.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`: passed, 7 files / 95 tests.
- `pnpm test`: passed, 94 files passed / 1 skipped, 1142 tests passed / 12 skipped.
- `pnpm build`: passed across workspace packages.

Notes:

- API tests intentionally exercise unavailable audit stores and missing production run-event token secret paths; Nest logs expected `ERROR [ExceptionsHandler]` lines while the test process exits 0.
- Web accessibility tests emit the jsdom canvas `getContext()` warning from axe-core; the test process exits 0.

## No-Legacy Scan Results

- Old `apps/web/src/App.tsx`: removed.
- Old `apps/web/src/styles.css`: removed.
- Old `apps/web/src/api.ts` and `apps/web/src/api/*` shims: removed.
- Old `apps/web/src/workbenchState.ts`: removed.
- Old `.panel` / `.workbench-grid`: absent from product source and Web tests.
- `/legacy`: absent from product source and Web tests.
- Old manual loader copy (`Load role queue`, `Load cockpit`, `Load replay`): absent from product source and Web tests.
- Old `src/App` imports and `<App />` usage: absent.
- Product source raw/debug copy scan is clean outside gated Dev Tools.

Manual commands:

```bash
rg -n "workbench-grid|className=\"panel\"|\\.panel\\b|/legacy|Load role queue|Load cockpit|Load replay|src/main\\.tsx" apps/web tests/web -g '!no-legacy-web-ui.test.ts'
rg -n "label=\"release_id\"|aria-label=\"release_id\"|placeholder=\"release_id\"|>release_id<" apps/web tests/web -g '!no-legacy-web-ui.test.ts'
rg -n "from ['\"].*src/App['\"]|<App\\b" apps/web tests -g '!no-legacy-web-ui.test.ts'
rg -n "raw JSON|raw replay|raw payload|Replay payload|Load raw replay|Object ID|manual ID|manual .*loader|direct id loading|debug-only" apps/web/src -g '!**/dev-tools/**'
```

All four commands returned no matches.

## Visual Evidence

- Screenshot output: `test-results/web-product-routes/`.
- Reviewed representative populated and degraded captures at 375, 768, 1024, and 1440 px widths.
- Fixed a Workbench right-rail text wrapping issue found during screenshot review.
- Re-ran Web route e2e after the fix and rechecked the 1440 px Workbench screenshot.
- No obvious horizontal overflow, clipped controls, old debug panel styling, raw product-route controls, or card-in-card page composition remained in reviewed captures.
