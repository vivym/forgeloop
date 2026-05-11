# P1 Release Durable Strict Dogfood Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Release verification blockers by adding an opt-in strict Release dogfood command that proves durable Postgres reset and real `local_codex` evidence without weakening the fast deterministic dogfood path.

**Architecture:** Extract shared durable Postgres and strict local Codex harness helpers from the P0 dogfood scripts, then refactor Release dogfood around a reusable Release flow runner. Keep `dogfood:release-flow` deterministic and add `dogfood:release-flow:strict` for validated durable DB setup, UUID identity seeding, durable Release lifecycle, optional strict `local_codex` execution, public-safe cockpit/replay checks, and precise report semantics.

**Tech Stack:** TypeScript, tsx, Vitest, NestJS TestingModule, Supertest, Drizzle ORM, pg, Docker CLI, Codex CLI, pnpm workspaces.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-11-p1-release-durable-strict-dogfood-closure-design.md`
- Current report: `docs/superpowers/reports/p1-release-risk-radar-verification.md`
- Current deterministic script: `scripts/release-flow-dogfood.ts`
- Current P0 durable script: `scripts/p0-durable-dogfood.ts`
- Current P0 strict local Codex script: `scripts/p0-local-codex-dogfood.ts`
- Existing tests:
  - `tests/smoke/release-flow-dogfood-script.test.ts`
  - `tests/smoke/p0-durable-dogfood-script.test.ts`
  - `tests/smoke/p0-local-codex-dogfood-script.test.ts`
  - `tests/api/release-module.test.ts`
  - `tests/api/query-module.test.ts`

## Scope And Guardrails

- Execute implementation in a dedicated worktree, not directly on `main`.
- Do not change Release product behavior except where the dogfood closure exposes a concrete current-code blocker.
- Do not make `pnpm dogfood:release-flow` depend on Postgres, Docker, Codex auth, or dangerous mode confirmation.
- Do not claim `PASSED` for durable or strict markers unless that check actually ran and verified evidence.
- Do not write raw database URLs, absolute source paths, local artifact paths, `.worktrees` paths, `raw_metadata`, `runtime_metadata`, or secrets to the Release verification report.
- Use TDD. Add or update focused tests first, verify they fail for the expected reason, then implement.
- Commit after every task.
- If unrelated repo failures appear while running required verification, fix them before final completion.

## File Structure

### Shared Dogfood Harness

- Create: `scripts/dogfood/durable-postgres.ts`
  - Owns safe DB target discovery, reset-safety validation before schema mutation, disposable DB naming, schema push, reset, and cleanup.
  - Exports helpers reused by P0 durable dogfood and Release strict dogfood.
- Create: `scripts/dogfood/strict-local-codex.ts`
  - Owns strict enablement/preflight, dirty source classification, blocker sanitization, worktree/source guard helpers, terminal evidence checks, and public-safe report projections.
  - Keeps local paths and runtime metadata internal-only.
- Create: `scripts/dogfood/release-flow-core.ts`
  - Owns Release-specific deterministic and durable flow orchestration.
  - Exposes reusable report marker rendering and unsafe public-output assertions.
  - Seeds durable UUID organization, actors, and project for strict durable mode.

### Script Entrypoints

- Modify: `scripts/p0-durable-dogfood.ts`
  - Replace local durable DB helper code with imports from `scripts/dogfood/durable-postgres.ts`.
- Modify: `scripts/p0-local-codex-dogfood.ts`
  - Replace local preflight/evidence/report helper code with imports from `scripts/dogfood/strict-local-codex.ts` where practical.
  - Preserve existing P0 behavior and report text unless tests require safe redaction changes.
- Modify: `scripts/release-flow-dogfood.ts`
  - Keep as deterministic entrypoint.
  - Move shared Release flow logic to `scripts/dogfood/release-flow-core.ts`.
- Create: `scripts/release-flow-strict-dogfood.ts`
  - New strict entrypoint for durable reset and strict local Codex closure.
- Modify: `package.json`
  - Add `dogfood:release-flow:strict`.
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
  - Makes durable-mode UUID-backed P0 aggregates use UUID ids so public P0 APIs can write to the Postgres schema.
- Modify: `packages/workflow/src/execution-finalizer.ts`
  - Makes worker-finalized ReviewPacket and Artifact ids UUID-compatible and retry-safe for durable Postgres terminal evidence.
- Modify: `packages/workflow/src/activities.ts`
  - Keeps activity-level artifact persistence id generation aligned with the finalizer helper if still used by the workflow path.
- Modify: `tests/api/durable-id-generation.test.ts`
  - Proves durable public P0 API-created UUID-backed rows use UUID ids and can be used by the strict durable Release dogfood path.
- Modify: `tests/workflow/execution-finalizer.test.ts`
  - Proves worker-finalized ReviewPacket, Artifact, and TraceArtifactRef rows use stable UUID-compatible ids across retries.
- Modify: `tests/workflow/package-execution-workflow.test.ts`
  - Updates workflow integration expectations away from text ids such as `review-packet:<runSessionId>`.

### Tests

- Create: `tests/smoke/dogfood-durable-postgres.test.ts`
  - Tests shared durable DB planning, resettable disposable naming, safety-before-push sequencing, and status classification.
- Create: `tests/smoke/dogfood-strict-local-codex.test.ts`
  - Tests shared strict local Codex blocker classification, dirty allowlist, sanitized blocker details, internal-only Review Packet paths, and strict exit rules.
- Modify: `tests/smoke/p0-durable-dogfood-script.test.ts`
  - Keep P0 durable behavior covered after helper extraction.
- Modify: `tests/smoke/p0-local-codex-dogfood-script.test.ts`
  - Keep P0 strict behavior covered after helper extraction.
- Modify: `tests/smoke/release-flow-dogfood-script.test.ts`
  - Add deterministic runner, strict marker, strict report, and strict exit-code tests.

### Reports And Docs

- Modify: `docs/superpowers/reports/p1-release-risk-radar-verification.md`
  - Written by dogfood scripts.
  - Must show blocked durable/strict markers in default mode and pass/fail/block details in strict mode.
- Modify: `docs/superpowers/plans/2026-05-11-p1-release-durable-strict-dogfood-closure.md`
  - Mark tasks complete during execution.

---

### Task 0: Prepare The Feature Worktree

**Files:**
- No code files.

- [ ] **Step 1: Verify `main` status**

Run:

```bash
git status --short --branch
```

Expected: `main` is clean except for already committed spec/plan docs. If this plan file is uncommitted, commit it first on `main`:

```bash
git add docs/superpowers/plans/2026-05-11-p1-release-durable-strict-dogfood-closure.md
git commit -m "docs: plan release strict dogfood closure"
```

- [ ] **Step 2: Create the worktree**

Run:

```bash
git worktree add -b feature/p1-release-durable-strict-dogfood-closure /Users/viv/projs/forgeloop/.worktrees/p1-release-durable-strict-dogfood-closure main
```

Expected: worktree is created successfully.

- [ ] **Step 3: Enter the worktree**

Run:

```bash
cd /Users/viv/projs/forgeloop/.worktrees/p1-release-durable-strict-dogfood-closure
git status --short --branch
```

Expected: branch is `feature/p1-release-durable-strict-dogfood-closure` and status is clean.

- [ ] **Step 4: Run baseline focused tests**

Run:

```bash
pnpm vitest run tests/smoke/release-flow-dogfood-script.test.ts tests/smoke/p0-durable-dogfood-script.test.ts tests/smoke/p0-local-codex-dogfood-script.test.ts tests/api/release-module.test.ts tests/api/query-module.test.ts
```

Expected: all focused baseline tests pass. If unrelated failures appear, fix them before continuing and commit the fix separately.

- [ ] **Step 5: Commit nothing**

Run:

```bash
git status --short
```

Expected: no changes.

---

### Task 1: Extract The Shared Durable Postgres Harness

**Files:**
- Create: `scripts/dogfood/durable-postgres.ts`
- Modify: `scripts/p0-durable-dogfood.ts`
- Create: `tests/smoke/dogfood-durable-postgres.test.ts`
- Modify: `tests/smoke/p0-durable-dogfood-script.test.ts`

- [ ] **Step 1: Write failing tests for durable helper contract**

Create `tests/smoke/dogfood-durable-postgres.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  classifyDurableDogfoodError,
  databaseNameForDogfoodTimestamp,
  planDurableDogfoodDatabase,
  sanitizeDatabaseTargetForReport,
} from '../../scripts/dogfood/durable-postgres';

describe('shared durable dogfood postgres helper', () => {
  it('uses a resettable tmp database name for disposable dogfood databases', () => {
    expect(databaseNameForDogfoodTimestamp(1_778_256_000_000)).toBe('forgeloop_tmp_dogfood_1778256000000');
  });

  it('plans disposable databases with resettable names', () => {
    const plan = planDurableDogfoodDatabase({
      env: {},
      dockerCandidate: {
        containerId: 'container-1',
        host: '127.0.0.1',
        port: 15432,
        user: 'forgeloop',
        password: 'secret',
        defaultDatabase: 'postgres',
      },
      timestamp: 1_778_256_000_000,
    });

    expect(plan.databaseName).toBe('forgeloop_tmp_dogfood_1778256000000');
    expect(plan.cleanup).toEqual({ dropDatabase: true });
  });

  it('redacts database target details for reports', () => {
    expect(
      sanitizeDatabaseTargetForReport('postgresql://user:secret@127.0.0.1:5432/forgeloop_tmp_dogfood_1778256000000'),
    ).toEqual({
      host: '127.0.0.1',
      database: 'forgeloop_tmp_dogfood_1778256000000',
      redacted: true,
    });
  });

  it('classifies unavailable and unsafe targets as blocked but schema push failures as failed', () => {
    expect(classifyDurableDogfoodError({ code: 'missing_database' })).toEqual({ status: 'BLOCKED with reason' });
    expect(classifyDurableDogfoodError({ code: 'database_reset_refused' })).toEqual({ status: 'BLOCKED with reason' });
    expect(classifyDurableDogfoodError({ code: 'schema_push_failed' })).toEqual({ status: 'FAILED' });
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
pnpm vitest run tests/smoke/dogfood-durable-postgres.test.ts
```

Expected: FAIL because `scripts/dogfood/durable-postgres.ts` does not exist.

- [ ] **Step 3: Create the shared helper with extracted durable code**

Create `scripts/dogfood/durable-postgres.ts` with these exports:

```ts
import { execFile as execFileCallback } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { Client } from 'pg';

import { assertResettableDatabaseUrl, resetForgeloopDatabase } from '../../packages/db/src/reset.js';

const execFile = promisify(execFileCallback);

export type Env = Record<string, string | undefined>;

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { env?: Env; timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string }>;

export type DockerPostgresCandidate = {
  containerId: string;
  host: string;
  port: number;
  user: string;
  password: string;
  defaultDatabase: string;
};

export type DurableDogfoodPlan = {
  kind: 'provided' | 'docker_temp_db' | 'started_container';
  databaseUrl: string;
  adminUrl: string;
  databaseName: string;
  cleanup: { dropDatabase: boolean; removeContainer?: boolean };
  containerId?: string;
};

export type DurableDogfoodErrorCode =
  | 'missing_database'
  | 'database_reset_refused'
  | 'schema_push_failed'
  | 'reset_failed';

export const databaseNameForDogfoodTimestamp = (timestamp: number): string => `forgeloop_tmp_dogfood_${timestamp}`;

export const providedDatabaseUrlFromEnv = (env: Env): string | undefined => {
  const value = env.FORGELOOP_DATABASE_URL?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

export const sanitizeDatabaseTargetForReport = (databaseUrl: string): { host: string; database: string; redacted: true } => {
  const url = new URL(databaseUrl);
  return { host: url.hostname, database: url.pathname.replace(/^\//, ''), redacted: true };
};

export const classifyDurableDogfoodError = (error: { code: DurableDogfoodErrorCode }): { status: 'BLOCKED with reason' | 'FAILED' } => {
  if (error.code === 'schema_push_failed' || error.code === 'reset_failed') {
    return { status: 'FAILED' };
  }
  return { status: 'BLOCKED with reason' };
};
```

Then move the current Docker discovery, `createDatabase`, `dropDatabase`, and `startDisposablePostgres` helpers from `scripts/p0-durable-dogfood.ts` into this file. Preserve their current behavior except for disposable database naming.

- [ ] **Step 4: Add safe phase helpers**

In `scripts/dogfood/durable-postgres.ts`, add these functions:

```ts
export const prepareSafeDatabaseTarget = (plan: DurableDogfoodPlan): void => {
  assertResettableDatabaseUrl(plan.databaseUrl);
};

export const pushSchema = async (input: { databaseUrl: string; runCommand: CommandRunner }): Promise<void> => {
  await input.runCommand('pnpm', ['db:push'], {
    env: { FORGELOOP_DATABASE_URL: input.databaseUrl },
    timeoutMs: 60_000,
  });
};

export const resetDatabase = async (databaseUrl: string): Promise<void> => {
  await resetForgeloopDatabase(databaseUrl);
};
```

Important ordering for callers: `prepareSafeDatabaseTarget(plan)` must run before `pushSchema(...)`, and `resetDatabase(...)` must run after `pushSchema(...)` and before dogfood data creation.

- [ ] **Step 5: Update P0 durable script to import shared helpers**

Modify `scripts/p0-durable-dogfood.ts`:

```ts
import {
  createDatabase,
  discoverDockerPostgresCandidate,
  dropDatabase,
  planDurableDogfoodDatabase,
  prepareSafeDatabaseTarget,
  providedDatabaseUrlFromEnv,
  pushSchema,
  resetDatabase,
  startDisposablePostgres,
} from './dogfood/durable-postgres.js';
```

Keep P0's report parsing in the P0 script because it is P0-report-specific. Replace its main DB setup sequence with:

```ts
prepareSafeDatabaseTarget(plan);
await createDatabase(plan);
await pushSchema({ databaseUrl: plan.databaseUrl, runCommand });
await resetDatabase(plan.databaseUrl);
await runCommand('pnpm', ['dogfood:p0'], {
  env: { FORGELOOP_DATABASE_URL: plan.databaseUrl, FORGELOOP_REPORT_PATH: reportPath },
  timeoutMs: 120_000,
});
```

Export `createDatabase` from the shared helper and import it explicitly as shown above. Do not let `dogfood:p0` run against unvalidated inherited environment URLs.

- [ ] **Step 6: Update existing P0 durable tests**

Modify `tests/smoke/p0-durable-dogfood-script.test.ts` imports so DB helper exports come from `../../scripts/dogfood/durable-postgres`, while `parseDurableDogfoodReport` continues to come from `../../scripts/p0-durable-dogfood`.

Update the temp DB expectation:

```ts
expect(plan.databaseName).toBe('forgeloop_tmp_dogfood_1778256000000');
```

- [ ] **Step 7: Run durable helper and P0 tests**

Run:

```bash
pnpm vitest run tests/smoke/dogfood-durable-postgres.test.ts tests/smoke/p0-durable-dogfood-script.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add scripts/dogfood/durable-postgres.ts scripts/p0-durable-dogfood.ts tests/smoke/dogfood-durable-postgres.test.ts tests/smoke/p0-durable-dogfood-script.test.ts
git commit -m "test: extract durable dogfood postgres harness"
```

---

### Task 2: Extract The Shared Strict Local Codex Harness

**Files:**
- Create: `scripts/dogfood/strict-local-codex.ts`
- Modify: `scripts/p0-local-codex-dogfood.ts`
- Create: `tests/smoke/dogfood-strict-local-codex.test.ts`
- Modify: `tests/smoke/p0-local-codex-dogfood-script.test.ts`

- [ ] **Step 1: Write failing tests for sanitized strict helper behavior**

Create `tests/smoke/dogfood-strict-local-codex.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  classifyStrictLocalCodexExit,
  classifyStrictLocalCodexReportStatus,
  releaseStrictDirtyAllowlist,
  sanitizeStrictBlockerDetails,
} from '../../scripts/dogfood/strict-local-codex';

describe('shared strict local Codex dogfood helper', () => {
  it('defines the release strict dirty allowlist as repo-relative paths', () => {
    expect(releaseStrictDirtyAllowlist).toEqual([
      'docs/superpowers/reports/p1-release-risk-radar-verification.md',
      '.superpowers/**',
    ]);
  });

  it('sanitizes blocker details before report rendering', () => {
    expect(
      sanitizeStrictBlockerDetails({
        workspace_path: '/Users/viv/projs/forgeloop/.worktrees/run-1',
        database_url: 'postgresql://user:secret@localhost:5432/db',
        allowed_dirty_entries: ['docs/superpowers/reports/p1-release-risk-radar-verification.md'],
        blocked_dirty_entries: ['/Users/viv/projs/forgeloop/README.md'],
      }),
    ).toEqual({
      redacted_detail_count: 2,
      allowed_dirty_entries: ['docs/superpowers/reports/p1-release-risk-radar-verification.md'],
      blocked_dirty_entries: ['README.md'],
    });
  });

  it('keeps failed markers non-zero even when blocked reports are allowed', () => {
    expect(classifyStrictLocalCodexExit({ markers: ['FAILED'], allowBlocked: true })).toBe(1);
    expect(classifyStrictLocalCodexExit({ markers: ['BLOCKED with reason'], allowBlocked: false })).toBe(1);
    expect(classifyStrictLocalCodexExit({ markers: ['BLOCKED with reason'], allowBlocked: true })).toBe(0);
    expect(classifyStrictLocalCodexExit({ markers: ['PASSED'], allowBlocked: false })).toBe(0);
  });

  it('classifies preflight blockers as blocked and terminal evidence failures as failed', () => {
    expect(classifyStrictLocalCodexReportStatus('dangerous_mode_unconfirmed')).toBe('BLOCKED with reason');
    expect(classifyStrictLocalCodexReportStatus('missing_terminal_evidence')).toBe('FAILED');
    expect(classifyStrictLocalCodexReportStatus('missing_public_non_terminal_live_event')).toBe('FAILED');
    expect(classifyStrictLocalCodexReportStatus('local_codex_run_terminal_timeout')).toBe('FAILED');
    expect(classifyStrictLocalCodexReportStatus('public_projection_leak')).toBe('FAILED');
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
pnpm vitest run tests/smoke/dogfood-strict-local-codex.test.ts
```

Expected: FAIL because `scripts/dogfood/strict-local-codex.ts` does not exist.

- [ ] **Step 3: Create the shared strict helper**

Create `scripts/dogfood/strict-local-codex.ts`. Move these reusable items from `scripts/p0-local-codex-dogfood.ts`:

- `evaluateLocalCodexDogfoodEnablement`
- dirty source parsing/classification
- strict blocker type helpers
- command availability checks
- `preflightLocalCodexDogfood`
- `buildCodexExecFallbackCommand`
- `selectCodexExecutionMode`
- runtime metadata validation
- terminal evidence validation
- live event observation validation
- source guard injection helpers

Add these release-specific helper exports without coupling them to P0:

```ts
export const releaseStrictDirtyAllowlist = [
  'docs/superpowers/reports/p1-release-risk-radar-verification.md',
  '.superpowers/**',
] as const;

export type StrictMarkerStatus = 'PASSED' | 'BLOCKED with reason' | 'FAILED';

export const classifyStrictLocalCodexReportStatus = (code: string): StrictMarkerStatus => {
  if (
    code === 'local_codex_terminal_failed' ||
    code === 'local_codex_run_terminal_timeout' ||
    code === 'missing_terminal_evidence' ||
    code === 'missing_public_non_terminal_live_event' ||
    code === 'public_projection_leak'
  ) {
    return 'FAILED';
  }
  return 'BLOCKED with reason';
};

export const classifyStrictLocalCodexExit = (input: {
  markers: StrictMarkerStatus[];
  allowBlocked: boolean;
}): 0 | 1 => {
  if (input.markers.includes('FAILED')) {
    return 1;
  }
  if (input.markers.every((marker) => marker === 'PASSED')) {
    return 0;
  }
  return input.allowBlocked ? 0 : 1;
};
```

- [ ] **Step 4: Implement sanitized blocker detail rendering**

In `scripts/dogfood/strict-local-codex.ts`, add:

```ts
const repoRelativeOrBasename = (value: string): string => {
  const normalized = value.replace(/\\/g, '/');
  const marker = '/forgeloop/';
  const index = normalized.lastIndexOf(marker);
  if (index >= 0) {
    return normalized.slice(index + marker.length);
  }
  return normalized.split('/').filter(Boolean).at(-1) ?? '[redacted]';
};

export const sanitizeStrictBlockerDetails = (details: Record<string, unknown>): Record<string, unknown> => {
  const sanitized: Record<string, unknown> = {};
  let redactedDetailCount = 0;
  for (const [key, value] of Object.entries(details)) {
    if (/path|url|secret|metadata|stderr|token|password|api[_-]?key|authorization/i.test(key)) {
      redactedDetailCount += 1;
      continue;
    }
    if (Array.isArray(value) && /dirty_entries/i.test(key)) {
      sanitized[key] = value.map((entry) => (typeof entry === 'string' ? repoRelativeOrBasename(entry) : '[redacted]'));
      continue;
    }
    sanitized[key] = value;
  }
  if (redactedDetailCount > 0) {
    sanitized.redacted_detail_count = redactedDetailCount;
  }
  return sanitized;
};

export const sanitizeStrictPreflightBlockerDetails = (preflight: {
  blockers: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
}): string[] =>
  preflight.blockers.map((blocker) => {
    const details = blocker.details === undefined ? undefined : sanitizeStrictBlockerDetails(blocker.details);
    return `${blocker.code}: ${blocker.message}${details === undefined ? '' : ` ${JSON.stringify(details)}`}`;
  });
```

Adjust if tests reveal the regex redacts `allowed_dirty_entries`; the expected behavior is to preserve repo-relative dirty entries and basename absolute ones.

Do not preserve unsafe detail key names such as `workspace_path`, `database_url`, `artifact_path`, `runtime_metadata`, or `stderr` in report-bound marker details, even with redacted values. The Release report safety checks intentionally reject those key names. Represent them only as safe counts such as `redacted_detail_count`.

- [ ] **Step 5: Update P0 local Codex script to import shared helpers**

Modify `scripts/p0-local-codex-dogfood.ts` to import shared helpers. Keep P0-specific functions in the P0 script:

- `buildBoundedLocalCodexRunPackage`
- `renderLocalCodexDogfoodReport`
- API creation/polling functions
- P0 source guard orchestration if still P0-specific

Do not change public P0 report strings unless required to remove unsafe details. If report output changes, update `tests/smoke/p0-local-codex-dogfood-script.test.ts` intentionally.

Keep backwards-compatible exports from `scripts/p0-local-codex-dogfood.ts` for helpers consumed by `scripts/p0-dogfood-work-items.ts`, including `preflightLocalCodexDogfood` and strict dirty allowlist constants. Either re-export them from the P0 script after moving the implementation, or update `scripts/p0-dogfood-work-items.ts` imports in the same task.

- [ ] **Step 6: Run strict helper and P0 tests**

Run:

```bash
pnpm vitest run tests/smoke/dogfood-strict-local-codex.test.ts tests/smoke/p0-local-codex-dogfood-script.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add scripts/dogfood/strict-local-codex.ts scripts/p0-local-codex-dogfood.ts tests/smoke/dogfood-strict-local-codex.test.ts tests/smoke/p0-local-codex-dogfood-script.test.ts
git commit -m "test: extract strict local codex dogfood harness"
```

---

### Task 3: Refactor Release Dogfood Into A Reusable Core Runner

**Files:**
- Create: `scripts/dogfood/release-flow-core.ts`
- Modify: `scripts/release-flow-dogfood.ts`
- Modify: `tests/smoke/release-flow-dogfood-script.test.ts`

- [ ] **Step 1: Write failing tests for reusable Release report helpers**

Modify `tests/smoke/release-flow-dogfood-script.test.ts`:

```ts
import {
  assertNoUnsafeReleaseDogfoodStrings,
  renderReleaseFlowVerificationReport,
  requiredReleaseFlowReportMarkers,
  strictReleaseClosureMarkers,
} from '../../scripts/dogfood/release-flow-core';

it('defines the strict closure markers separately from all required report markers', () => {
  expect(strictReleaseClosureMarkers).toEqual(['Durable local reset', 'Strict local_codex run']);
});

it('renders failed markers and blocked markers without unsafe values', () => {
  const report = renderReleaseFlowVerificationReport([
    ...requiredReleaseFlowReportMarkers.map((marker) => ({
      marker,
      status: marker === 'Durable local reset' ? 'FAILED' : marker === 'Strict local_codex run' ? 'BLOCKED with reason' : 'PASSED',
      details: ['safe detail'],
    })),
  ]);

  expect(report).toContain('Status: FAILED');
  expect(report).toContain('Status: BLOCKED with reason');
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', report)).not.toThrow();
});

it('rejects unsafe public report strings', () => {
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { path: '/Users/viv/projs/forgeloop/.worktrees/run-1' })).toThrow(
    /unsafe serialized string/,
  );
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { local_ref: '/tmp/forgeloop-executor-artifacts/review.md' })).toThrow(
    /unsafe serialized string/,
  );
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { artifact_path: '/var/folders/tmp/review.md' })).toThrow(
    /unsafe serialized string/,
  );
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { storage_uri: '/tmp/custom-artifacts/review.md' })).toThrow(
    /unsafe serialized pattern/,
  );
  expect(() =>
    assertNoUnsafeReleaseDogfoodStrings('report', { storage_uri: `${process.env.FORGELOOP_EXECUTOR_ARTIFACT_ROOT ?? '/tmp/codex-run'}/review.md` }),
  ).toThrow(/unsafe serialized pattern/);
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { authorization: 'Bearer secret' })).toThrow(
    /unsafe serialized string/,
  );
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { accessToken: 'secret' })).toThrow(/unsafe serialized pattern/);
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { clientSecret: 'secret' })).toThrow(/unsafe serialized pattern/);
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { apiKey: 'secret' })).toThrow(/unsafe serialized pattern/);
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { Authorization: 'Bearer secret' })).toThrow(/unsafe serialized pattern/);
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { databaseUrl: 'postgresql://user:secret@localhost/db' })).toThrow(
    /unsafe serialized string/,
  );
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { localRef: '/home/runner/work/forgeloop/review.md' })).toThrow(
    /unsafe serialized pattern/,
  );
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { artifactPath: '/opt/forgeloop/artifact.md' })).toThrow(
    /unsafe serialized pattern/,
  );
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { rawMetadata: { ok: true } })).toThrow(/unsafe serialized pattern/);
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { runtimeMetadata: { ok: true } })).toThrow(/unsafe serialized pattern/);
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { sessionSecret: 'secret' })).toThrow(/unsafe serialized pattern/);
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { path: 'C:\\Users\\viv\\forgeloop\\artifact.md' })).toThrow(
    /unsafe serialized pattern/,
  );
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { allowedPaths: ['README.md'] })).toThrow(/unsafe serialized pattern/);
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { forbiddenPaths: ['.env'] })).toThrow(/unsafe serialized pattern/);
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { workspace_path: '[redacted]' })).toThrow(/unsafe serialized pattern/);
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { workspacePath: '[redacted]' })).toThrow(/unsafe serialized pattern/);
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { worktree_path: '[redacted]' })).toThrow(/unsafe serialized pattern/);
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { worktreePath: '[redacted]' })).toThrow(/unsafe serialized pattern/);
  expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { runtime_metadata: { workspace_path: 'x' } })).toThrow(
    /unsafe serialized string/,
  );
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
pnpm vitest run tests/smoke/release-flow-dogfood-script.test.ts
```

Expected: FAIL because `scripts/dogfood/release-flow-core.ts` does not exist and exports moved from the old script are missing.

- [ ] **Step 3: Create `release-flow-core.ts`**

Move reusable types/constants/helpers from `scripts/release-flow-dogfood.ts` to `scripts/dogfood/release-flow-core.ts`:

```ts
export type MarkerStatus = 'PASSED' | 'BLOCKED with reason' | 'FAILED';

export type VerificationMarker = {
  marker: (typeof requiredReleaseFlowReportMarkers)[number];
  status: MarkerStatus;
  details: string[];
};

export const requiredReleaseFlowReportMarkers = [
  'P0 delivery path',
  'Release create/link/submit',
  'Release approval or override approval',
  'Release observing/close',
  'Release cockpit query',
  'Release replay redaction',
  'Release observation backlink projection',
  'Durable local reset',
  'Strict local_codex run',
] as const;

export const strictReleaseClosureMarkers = ['Durable local reset', 'Strict local_codex run'] as const;
```

Also move:

- `renderReleaseFlowVerificationReport`
- unsafe-string assertion logic
- Release cockpit/replay assertions
- deterministic Release lifecycle runner helpers that do not need to stay in the wrapper.

- [ ] **Step 4: Extend unsafe-string checks**

In `scripts/dogfood/release-flow-core.ts`, ensure unsafe strings include:

```ts
const unsafeSerializedStrings = [
  '/Users/',
  '/workspace/',
  '.worktrees',
  'raw_metadata',
  'runtime_metadata',
  'allowed_paths',
  'forbidden_paths',
  'client_secret',
  'access_token',
  'api_key',
  'authorization',
  'database_url',
  'rawMetadata',
  'runtimeMetadata',
  'allowedPaths',
  'forbiddenPaths',
  'workspace_path',
  'workspacePath',
  'worktree_path',
  'worktreePath',
  'password',
  'secret',
  'token',
  'local_ref',
  'localRef',
  'artifact_path',
  'artifactPath',
  '/tmp/forgeloop-executor-artifacts',
  '/var/folders/',
  'postgresql://',
  'postgres://',
] as const;

const unsafeSerializedPatterns = [
  /\/tmp\//i,
  /\/private\/var\/folders\//i,
  /\/var\/folders\//i,
  /\/home\//i,
  /\/opt\//i,
  /[A-Za-z]:[\\/]/i,
  /forgeloop-executor-artifacts/i,
  /local[_-]?ref/i,
  /artifact[_-]?path/i,
  /allowed[_-]?paths/i,
  /forbidden[_-]?paths/i,
  /workspace[_-]?path/i,
  /worktree[_-]?path/i,
  /raw[_-]?metadata/i,
  /runtime[_-]?metadata/i,
  /database[_-]?url/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /api[_-]?key/i,
  /client[_-]?secret/i,
  /session[_-]?secret/i,
  /authorization/i,
  /secret/i,
  /password/i,
] as const;
```

Export:

```ts
export const assertNoUnsafeReleaseDogfoodStrings = (label: string, value: unknown): void => {
  const serialized = JSON.stringify(value);
  for (const unsafe of unsafeSerializedStrings) {
    if (serialized.toLowerCase().includes(unsafe.toLowerCase())) {
      throw new Error(`${label} exposed unsafe serialized string: ${unsafe}`);
    }
  }
  for (const pattern of unsafeSerializedPatterns) {
    if (pattern.test(serialized)) {
      throw new Error(`${label} exposed unsafe serialized pattern: ${pattern.source}`);
    }
  }
};
```

- [ ] **Step 5: Reduce `scripts/release-flow-dogfood.ts` to deterministic entrypoint**

Modify `scripts/release-flow-dogfood.ts` so it imports from core:

```ts
import {
  renderReleaseFlowVerificationReport,
  requiredReleaseFlowReportMarkers,
  runDeterministicReleaseFlowDogfood,
} from './dogfood/release-flow-core.js';
```

The wrapper should keep only:

- report path resolution;
- `writeReport`;
- `main`;
- `isMainModule` guard.

Keep the public export `requiredReleaseFlowReportMarkers` from this wrapper for compatibility:

```ts
export { requiredReleaseFlowReportMarkers } from './dogfood/release-flow-core.js';
```

- [ ] **Step 6: Run deterministic Release dogfood tests and script**

Run:

```bash
pnpm vitest run tests/smoke/release-flow-dogfood-script.test.ts
pnpm dogfood:release-flow
```

Expected:

- Vitest passes.
- `pnpm dogfood:release-flow` exits `0`.
- `docs/superpowers/reports/p1-release-risk-radar-verification.md` still shows deterministic markers as `PASSED` and durable/strict markers as `BLOCKED with reason`.

- [ ] **Step 7: Commit**

Run:

```bash
git add scripts/dogfood/release-flow-core.ts scripts/release-flow-dogfood.ts tests/smoke/release-flow-dogfood-script.test.ts docs/superpowers/reports/p1-release-risk-radar-verification.md
git commit -m "refactor: share release flow dogfood core"
```

---

### Task 4: Add Durable Release Strict Flow Without Real Codex Yet

**Files:**
- Modify: `scripts/dogfood/release-flow-core.ts`
- Create: `scripts/release-flow-strict-dogfood.ts`
- Modify: `tests/smoke/release-flow-dogfood-script.test.ts`
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Modify: `packages/workflow/src/execution-finalizer.ts`
- Modify: `packages/workflow/src/activities.ts`
- Modify: `tests/api/durable-id-generation.test.ts`
- Modify: `tests/workflow/execution-finalizer.test.ts`
- Modify: `tests/workflow/package-execution-workflow.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for durable identity seeding and strict blocked mode**

Modify `tests/smoke/release-flow-dogfood-script.test.ts`:

```ts
import {
  buildDurableReleaseDogfoodIdentity,
  renderReleaseFlowVerificationReport,
  statusCodeForStrictReleaseMarkers,
} from '../../scripts/dogfood/release-flow-core';

it('builds UUID durable identity seed records', () => {
  const seed = buildDurableReleaseDogfoodIdentity('2026-05-11T00:00:00.000Z');

  expect(seed.organization.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(seed.actors.owner.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(seed.actors.reviewer.org_id).toBe(seed.organization.id);
  expect(seed.project.org_id).toBe(seed.organization.id);
  expect(seed.project.owner_actor_id).toBe(seed.actors.owner.id);
});

it('returns non-zero for blocked strict markers unless blocked report generation is allowed', () => {
  const markers = requiredReleaseFlowReportMarkers.map((marker) => ({
    marker,
    status: marker === 'Strict local_codex run' ? 'BLOCKED with reason' : 'PASSED',
    details: ['safe'],
  }));

  expect(statusCodeForStrictReleaseMarkers(markers, { allowBlocked: false })).toBe(1);
  expect(statusCodeForStrictReleaseMarkers(markers, { allowBlocked: true })).toBe(0);
});
```

Modify `tests/api/durable-id-generation.test.ts` to prove durable public P0 API ids are UUIDs for every UUID-backed aggregate the strict Release flow will create:

```ts
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

it('uses UUID ids for durable public P0 API-created aggregates', async () => {
  const repository = new InMemoryP0Repository();
  const app = await createDurableApp(repository);
  const server = app.getHttpServer();
  const ownerActorId = '11111111-1111-4111-8111-111111111111';
  const reviewerActorId = '22222222-2222-4222-8222-222222222222';
  const qaActorId = '33333333-3333-4333-8333-333333333333';

  const project = (await request(server).post('/projects').send({ name: 'Durable UUIDs', owner_actor_id: ownerActorId }).expect(201)).body;
  await request(server).post(`/projects/${project.id}/repos`).send({
    repo_id: 'forgeloop-source',
    name: 'forgeloop',
    local_path: '/workspace/forgeloop',
    base_commit_sha: 'base',
  }).expect(201);
  const workItem = (await request(server).post('/work-items').send({
    project_id: project.id,
    kind: 'requirement',
    title: 'Durable UUID path',
    goal: 'Prove durable ids',
    success_criteria: ['ids are UUIDs'],
    priority: 'P1',
    risk: 'low',
    owner_actor_id: ownerActorId,
  }).expect(201)).body;
  const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
  const specRevision = (await request(server).post(`/specs/${spec.id}/revisions`).send({
    summary: 'Durable spec',
    content: 'Spec content',
    background: 'Background',
    goals: ['Goal'],
    scope_in: ['In'],
    scope_out: ['Out'],
    acceptance_criteria: ['Accept'],
    test_strategy_summary: 'Test',
    author_actor_id: ownerActorId,
  }).expect(201)).body;
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).set('X-Forgeloop-Actor-Id', ownerActorId).send({ actor_id: ownerActorId }).expect(201);
  await request(server).post(`/specs/${spec.id}/approve`).set('X-Forgeloop-Actor-Id', reviewerActorId).send({ actor_id: reviewerActorId }).expect(201);
  const plan = (await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(201)).body;
  const planRevision = (await request(server).post(`/plans/${plan.id}/revisions`).send({
    summary: 'Durable plan',
    content: 'Plan content',
    implementation_summary: 'Implement',
    split_strategy: 'One package',
    dependency_order: [],
    test_matrix: ['pnpm test'],
    rollback_notes: 'Revert',
    author_actor_id: ownerActorId,
  }).expect(201)).body;
  await request(server).post(`/plans/${plan.id}/submit-for-approval`).set('X-Forgeloop-Actor-Id', ownerActorId).send({ actor_id: ownerActorId }).expect(201);
  await request(server).post(`/plans/${plan.id}/approve`).set('X-Forgeloop-Actor-Id', reviewerActorId).send({ actor_id: reviewerActorId }).expect(201);
  const executionPackage = (await request(server).post(`/plan-revisions/${planRevision.id}/execution-packages`).send({
    repo_id: 'forgeloop-source',
    objective: 'Durable package',
    owner_actor_id: ownerActorId,
    reviewer_actor_id: reviewerActorId,
    qa_owner_actor_id: qaActorId,
    required_checks: [{ check_id: 'unit', display_name: 'Unit', command: 'node -e "process.exit(0)"', timeout_seconds: 30, blocks_review: true }],
    required_artifact_kinds: ['execution_summary'],
    allowed_paths: ['README.md'],
    forbidden_paths: ['.git'],
  }).expect(201)).body;
  await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).set('X-Forgeloop-Actor-Id', ownerActorId).send({ actor_id: ownerActorId }).expect(201);
  const run = (await request(server).post(`/execution-packages/${executionPackage.id}/run`).set('X-Forgeloop-Actor-Id', ownerActorId).send({
    requested_by_actor_id: ownerActorId,
    executor_type: 'mock',
    workflow_only: true,
  }).expect(202)).body;

  for (const id of [project.id, workItem.id, spec.id, specRevision.id, plan.id, planRevision.id, executionPackage.id, run.run_session_id]) {
    expect(id).toMatch(uuidPattern);
  }
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm vitest run tests/smoke/release-flow-dogfood-script.test.ts tests/api/durable-id-generation.test.ts
```

Expected: FAIL because the new Release exports do not exist and durable P0 public API-created aggregates still use non-UUID ids.

- [ ] **Step 3: Implement durable P0 UUID id generation and durable identity seed helper**

In `apps/control-plane-api/src/p0/p0.service.ts`, update the durable id generator so UUID-backed tables receive UUID ids in durable mode:

```ts
const uuidBackedP0IdPrefixes = new Set([
  'project',
  'work-item',
  'spec',
  'spec-revision',
  'plan',
  'plan-revision',
  'execution-package',
  'run-session',
  'decision',
]);

private id(prefix: string): string {
  this.idCounter += 1;
  if (this.durabilityMode === 'durable' && uuidBackedP0IdPrefixes.has(prefix)) {
    return randomUUID();
  }
  if (this.durabilityMode === 'durable') {
    return `${prefix}-${this.durableInstanceId}-${this.idCounter}`;
  }
  return `${prefix}-${this.idCounter}`;
}
```

Do not add UUID generation for text-key helper rows such as `project-repo`, `event`, `status-history`, `run-command`, or trace rows. The goal is to match the current Drizzle schema, not to convert every public id string.

In `scripts/dogfood/release-flow-core.ts`, add:

```ts
import { randomUUID } from 'node:crypto';
import type { Actor, Organization, Project } from '../../packages/domain/src/index.js';

export const buildDurableReleaseDogfoodIdentity = (createdAt: string): {
  organization: Organization;
  actors: { owner: Actor; reviewer: Actor; qa: Actor };
  project: Project;
} => {
  const organization: Organization = {
    id: randomUUID(),
    name: 'Release Strict Dogfood',
    created_at: createdAt,
    updated_at: createdAt,
  };
  const actor = (displayName: string): Actor => ({
    id: randomUUID(),
    org_id: organization.id,
    actor_type: 'human',
    display_name: displayName,
    created_at: createdAt,
    updated_at: createdAt,
  });
  const owner = actor('Release Owner Dogfood');
  const reviewer = actor('Release Reviewer Dogfood');
  const qa = actor('Release QA Dogfood');

  return {
    organization,
    actors: { owner, reviewer, qa },
    project: {
      id: randomUUID(),
      org_id: organization.id,
      key: 'release-strict-dogfood',
      name: 'Release Strict Dogfood',
      repo_ids: [],
      owner_actor_id: owner.id,
      created_at: createdAt,
      updated_at: createdAt,
    },
  };
};
```

Adjust imports to match actual domain package exports.

- [ ] **Step 4: Write failing tests for workflow-finalized UUID terminal evidence ids**

Modify `tests/workflow/execution-finalizer.test.ts` and `tests/workflow/package-execution-workflow.test.ts` so worker-finalized rows no longer assert ids like `review-packet:${runSession.id}` or `artifact:${runSession.id}:...`.

Add assertions that:

- `finalResult.reviewPacketId` matches a UUID pattern;
- every persisted `Artifact.id` created from terminal executor artifacts matches a UUID pattern;
- every `TraceArtifactRef.artifact_id` points to the UUID artifact id actually saved for the matching terminal artifact;
- finalizing the same completed run a second time returns the same ReviewPacket id and the same TraceArtifactRef rows, with no duplicate ReviewPacket/Artifact rows;
- existing text-key trace ids and trace artifact ref ids may remain text because their schema columns are text.

Example assertion shape:

```ts
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

expect(finalResult.reviewPacketId).toMatch(uuidPattern);
expect(savedArtifacts.map((artifact) => artifact.id).every((id) => uuidPattern.test(id))).toBe(true);
expect(traceArtifactRefs.map((ref) => ref.artifact_id).sort()).toEqual(savedArtifacts.map((artifact) => artifact.id).sort());

const secondResult = await finalizePackageRunWithExecutorResult(sameInput);
expect(secondResult.reviewPacketId).toBe(finalResult.reviewPacketId);
expect(await repo.listTraceArtifactRefs(terminalTraceEvent.id)).toEqual(traceArtifactRefs);
```

- [ ] **Step 5: Implement stable UUID-compatible workflow finalizer ids**

In `packages/workflow/src/execution-finalizer.ts`, replace text ids for UUID-backed rows with stable UUID-derived ids:

```ts
import { createHash } from 'node:crypto';

export const stableWorkflowUuidFor = (key: string): string => {
  const hex = createHash('sha256').update(`forgeloop-workflow:${key}`).digest('hex');
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
};

export const reviewPacketIdForRunSession = (runSessionId: string): string =>
  stableWorkflowUuidFor(`review-packet:${runSessionId}`);

export const artifactIdForRunSessionArtifact = (input: {
  runSessionId: string;
  index: number;
  kind: string;
  name: string;
}): string => stableWorkflowUuidFor(`artifact:${input.runSessionId}:${input.index}:${input.kind}:${input.name}`);
```

Use `reviewPacketIdForRunSession(runSession.id)` everywhere the finalizer currently reads or writes `review-packet:${runSession.id}`, including retry/idempotency checks in `loadFinalizationState`.

Use `artifactIdForRunSessionArtifact(...)` in both:

- `persistArtifacts(...)` when saving terminal artifacts;
- `recordTerminalEvidenceTrace(...)` when writing `TraceArtifactRef.artifact_id`.

If `packages/workflow/src/activities.ts` still has an activity-level `persistArtifacts(...)` path that saves `Artifact.id` as `artifact:${runSession.id}:...`, update it to import and use the same helper so all worker artifact persistence paths agree.

Run:

```bash
pnpm vitest run tests/workflow/execution-finalizer.test.ts tests/workflow/package-execution-workflow.test.ts
```

Expected: PASS after implementation. The tests should fail before this step because current finalizer ids are text strings incompatible with durable UUID schema.

- [ ] **Step 6: Implement strict marker exit helper**

In `scripts/dogfood/release-flow-core.ts`, add:

```ts
export const statusCodeForStrictReleaseMarkers = (
  markers: readonly VerificationMarker[],
  options: { allowBlocked: boolean },
): 0 | 1 => {
  if (markers.some((marker) => marker.status === 'FAILED')) {
    return 1;
  }
  if (markers.every((marker) => marker.status === 'PASSED')) {
    return 0;
  }
  const blockedMarkers = markers.filter((marker) => marker.status === 'BLOCKED with reason');
  const onlyStrictClosureMarkersAreBlocked = blockedMarkers.every(
    (marker) => strictReleaseClosureMarkers.includes(marker.marker as (typeof strictReleaseClosureMarkers)[number]),
  );
  return options.allowBlocked && onlyStrictClosureMarkersAreBlocked ? 0 : 1;
};
```

- [ ] **Step 7: Add strict entrypoint skeleton**

Create `scripts/release-flow-strict-dogfood.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  failedReleaseFlowMarkersFromError,
  renderReleaseFlowVerificationReport,
  runStrictReleaseFlowDogfood,
  statusCodeForStrictReleaseMarkers,
} from './dogfood/release-flow-core.js';

const reportPath = resolve(
  process.env.FORGELOOP_RELEASE_FLOW_DOGFOOD_REPORT_PATH ??
    'docs/superpowers/reports/p1-release-risk-radar-verification.md',
);

const writeReport = async (content: string): Promise<void> => {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, content, 'utf8');
};

export const main = async (): Promise<number> => {
  const markers = await runStrictReleaseFlowDogfood({ env: process.env });
  const report = renderReleaseFlowVerificationReport(markers);
  await writeReport(report);
  return statusCodeForStrictReleaseMarkers(markers, {
    allowBlocked: process.env.FORGELOOP_RELEASE_FLOW_STRICT_ALLOW_BLOCKED === '1',
  });
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(async (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      const markers = failedReleaseFlowMarkersFromError(error);
      await writeReport(renderReleaseFlowVerificationReport(markers));
      process.exitCode = 1;
    });
}
```

Initially, `runStrictReleaseFlowDogfood` may return safe `BLOCKED with reason` markers for missing DB or missing Codex. The entrypoint catch is only a last-resort report writer; expected strict phase errors must be converted to `FAILED` markers inside the runner so the report reflects what actually ran.

Add `failedReleaseFlowMarkersFromError(error)` in `scripts/dogfood/release-flow-core.ts`. It must return every required marker, mark deterministic prerequisites conservatively as `BLOCKED with reason` if they did not run, mark `Durable local reset` or `Strict local_codex run` as `FAILED` when the thrown error is classified to that phase, and sanitize details through the same report safety checks before rendering. Report details must use stable blocker/failure codes and short safe messages; do not copy raw exception messages or environment variable names such as `FORGELOOP_DATABASE_URL` into the public report because the safety scan intentionally treats database-url-like text as unsafe.

- [ ] **Step 8: Add package script**

Modify `package.json`:

```json
"dogfood:release-flow:strict": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/release-flow-strict-dogfood.ts"
```

- [ ] **Step 9: Implement durable-only strict flow**

In `scripts/dogfood/release-flow-core.ts`, implement `runStrictReleaseFlowDogfood({ env })` so it:

1. Plans a DB target with `planDurableDogfoodDatabase`.
2. Calls `prepareSafeDatabaseTarget(plan)` before `pushSchema`.
3. Creates disposable DB when needed.
4. Calls `pushSchema`.
5. Calls `resetDatabase`.
6. Creates a Drizzle repository with `createDbClient({ connectionString: plan.databaseUrl })`.
7. Calls `buildDurableReleaseDogfoodIdentity`.
8. Saves organization, actors, and seeded project through `repository.saveOrganization`, `saveActor`, and `saveProject`.
9. Boots a durable Nest app with:
   - `P0_REPOSITORY` overridden to the Drizzle repository.
   - `RUN_DURABILITY_MODE` overridden to `durable`.
   - `P0_DEMO_ACTOR_ID_FALLBACK` overridden to `false`.
   - `RUN_WORKER` overridden to a no-op worker for the durable-only path.
10. Binds `forgeloop-source` through `POST /projects/:projectId/repos` against the seeded project.
11. Creates WorkItem, Spec, Plan, and ExecutionPackage through public P0 APIs using seeded UUID owner/reviewer/QA actors.
12. Do not call `/specs/:id/generate-draft`, `/plans/:id/generate-draft`, or `/plan-revisions/:id/generate-packages` in the strict durable flow. Create spec and plan revisions explicitly through `/specs/:id/revisions` and `/plans/:id/revisions` with `author_actor_id` set to a seeded UUID actor. The mock generator endpoints currently use non-UUID system actor strings and are not a valid durable Postgres path until separately fixed.
13. Converts the deterministic seed package into release-ready evidence before linking it to any Release. Add a helper such as `seedDurableReleaseReadyPackageEvidence(...)` that saves a succeeded mock RunSession, a completed approved ReviewPacket, the required terminal artifacts/check results, and updates the ExecutionPackage to `phase: 'release'`, `gate_state: 'release_ready'`, `resolution: 'completed'`, with `last_run_session_id` and `current_review_packet_id` set. Also update the WorkItem to the completed/done state if Release gates or cockpit projections depend on that completion.
14. Add a helper-level test proving `seedDurableReleaseReadyPackageEvidence(...)` produces an ExecutionPackage that has no `package_not_release_ready`, `missing_approved_review_packet`, `failed_required_check`, or `missing_required_artifact` Release blockers when evaluated through the same Release gate/query path used by the strict runner.
15. Uses `X-Forgeloop-Actor-Id` headers for every durable command route that resolves an authenticated actor, while keeping body actor ids present when the DTO requires them.
16. Runs the Release lifecycle using the seeded UUID actors and the public Release APIs.
17. Captures the created Release id and closes the first Nest app plus the first DB pool.
18. Opens a fresh `createDbClient({ connectionString: plan.databaseUrl })`, a fresh Drizzle repository, and a fresh durable Nest app against the same database.
19. Queries `/query/release-cockpit/:releaseId` and `/query/replay/release/:releaseId` through the fresh app.
20. Marks `Durable local reset` as `PASSED` only after the fresh app/repository can read Release rows, links, decisions, evidence, cockpit, replay, succeeded run session, approved ReviewPacket, and release-ready ExecutionPackage without relying on the first in-process repository.
21. Closes the fresh app and fresh pool before cleanup.

If `pushSchema`, `resetDatabase`, durable seeding, durable app boot, durable lifecycle, or fresh-boundary verification fails after the corresponding phase started, catch the error, sanitize its details, return all required markers, and set `Durable local reset` to `FAILED`. Do not let expected durable failures bypass report rendering. For blocked durable prerequisites, emit stable codes such as `missing_database` or `database_reset_refused` and safe operator-facing hints; do not include raw database URLs, local paths, full command stderr, or unsafe environment variable names in marker details.

For now, if strict local Codex preflight is not yet integrated, set only `Strict local_codex run` to `BLOCKED with reason` with a safe detail.

- [ ] **Step 10: Add an explicit test for the durable reopen boundary**

Modify `tests/smoke/release-flow-dogfood-script.test.ts` with a helper-level test that stubs a strict runner dependency and asserts the durable verification callback runs on a second app/repository instance before `Durable local reset` can be `PASSED`.

Use a small injectable seam in `runStrictReleaseFlowDogfood`, for example:

```ts
await runStrictReleaseFlowDogfood({
  env,
  createDurableApp,
  verifyDurableReleaseAfterReopen,
});
```

Expected behavior:

```ts
expect(verifyDurableReleaseAfterReopen).toHaveBeenCalledWith(
  expect.objectContaining({ releaseId: expect.any(String) }),
);
```

Run:

```bash
pnpm vitest run tests/smoke/release-flow-dogfood-script.test.ts
```

Expected: FAIL until the strict runner exposes and uses the fresh-boundary verification seam.

- [ ] **Step 11: Test blocked strict command without DB**

Run:

```bash
FORGELOOP_RELEASE_FLOW_STRICT_ALLOW_BLOCKED=1 pnpm dogfood:release-flow:strict
```

Expected:

- Command exits `0`.
- Report contains `Durable local reset` as `BLOCKED with reason` if no safe DB/Docker is available.
- Report contains no raw DB URL or absolute path.

Then run without allow-blocked:

```bash
pnpm dogfood:release-flow:strict
```

Expected: exits non-zero when durable or strict closure marker is blocked.

- [ ] **Step 12: Run focused tests**

Run:

```bash
pnpm vitest run tests/smoke/release-flow-dogfood-script.test.ts tests/api/durable-id-generation.test.ts tests/workflow/execution-finalizer.test.ts tests/workflow/package-execution-workflow.test.ts tests/api/release-module.test.ts tests/api/query-module.test.ts
```

Expected: PASS.

- [ ] **Step 13: Commit**

Run:

```bash
git add scripts/dogfood/release-flow-core.ts scripts/release-flow-strict-dogfood.ts apps/control-plane-api/src/p0/p0.service.ts packages/workflow/src/execution-finalizer.ts packages/workflow/src/activities.ts tests/smoke/release-flow-dogfood-script.test.ts tests/api/durable-id-generation.test.ts tests/workflow/execution-finalizer.test.ts tests/workflow/package-execution-workflow.test.ts package.json docs/superpowers/reports/p1-release-risk-radar-verification.md
git commit -m "test: add strict release durable dogfood entrypoint"
```

---

### Task 5: Link Real Strict Local Codex Evidence Into The Release Flow

**Files:**
- Modify: `scripts/dogfood/release-flow-core.ts`
- Modify: `scripts/release-flow-strict-dogfood.ts`
- Modify: `tests/smoke/release-flow-dogfood-script.test.ts`
- Modify: `docs/superpowers/reports/p1-release-risk-radar-verification.md`

- [ ] **Step 1: Write failing tests for public-safe strict evidence projection**

Modify `tests/smoke/release-flow-dogfood-script.test.ts`:

```ts
import {
  buildReleaseStrictObservationLinks,
  publicStrictLocalCodexEvidenceSummary,
  shouldAttemptReleaseStrictLocalCodex,
} from '../../scripts/dogfood/release-flow-core';

it('uses contract-allowed relationships for strict local Codex observation links', () => {
  expect(
    buildReleaseStrictObservationLinks({
      releaseId: 'release-1',
      executionPackageId: 'package-1',
      runSessionId: 'run-1',
    }),
  ).toEqual([
    { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
    { object_type: 'execution_package', object_id: 'package-1', relationship: 'supports' },
    { object_type: 'run_session', object_id: 'run-1', relationship: 'generated_by' },
  ]);
});

it('summarizes strict local Codex evidence without local paths or runtime metadata', () => {
  const summary = publicStrictLocalCodexEvidenceSummary({
    runSessionId: 'run-1',
    changedFileCount: 1,
    checkCount: 1,
    artifactKinds: ['execution_summary', 'review_packet'],
    reviewPacketAvailable: true,
  });

  expect(JSON.stringify(summary)).not.toContain('/Users/');
  expect(JSON.stringify(summary)).not.toContain('runtime_metadata');
  expect(summary).toEqual({
    run_session_id: 'run-1',
    changed_file_count: 1,
    check_count: 1,
    artifact_kinds: ['execution_summary', 'review_packet'],
    review_packet_available: true,
  });
});

it('requires explicit real local Codex enablement before strict package execution', () => {
  expect(shouldAttemptReleaseStrictLocalCodex({})).toBe(false);
  expect(shouldAttemptReleaseStrictLocalCodex({ FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD: '1' })).toBe(true);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
pnpm vitest run tests/smoke/release-flow-dogfood-script.test.ts
```

Expected: FAIL because the helper exports do not exist.

- [ ] **Step 3: Implement observation link and summary helpers**

In `scripts/dogfood/release-flow-core.ts`, add:

```ts
export const buildReleaseStrictObservationLinks = (input: {
  releaseId: string;
  executionPackageId: string;
  runSessionId: string;
}) => [
  { object_type: 'release' as const, object_id: input.releaseId, relationship: 'observed' as const },
  { object_type: 'execution_package' as const, object_id: input.executionPackageId, relationship: 'supports' as const },
  { object_type: 'run_session' as const, object_id: input.runSessionId, relationship: 'generated_by' as const },
];

export const publicStrictLocalCodexEvidenceSummary = (input: {
  runSessionId: string;
  changedFileCount: number;
  checkCount: number;
  artifactKinds: string[];
  reviewPacketAvailable: boolean;
}) => ({
  run_session_id: input.runSessionId,
  changed_file_count: input.changedFileCount,
  check_count: input.checkCount,
  artifact_kinds: input.artifactKinds,
  review_packet_available: input.reviewPacketAvailable,
});

export const shouldAttemptReleaseStrictLocalCodex = (env: Record<string, string | undefined>): boolean =>
  evaluateLocalCodexDogfoodEnablement(env).enabled;
```

- [ ] **Step 4: Add strict local Codex preflight integration**

In `runStrictReleaseFlowDogfood`, after initial deterministic package link and before Release submit:

```ts
const enablement = evaluateLocalCodexDogfoodEnablement(env);

if (!enablement.enabled) {
  markers.push({
    marker: 'Strict local_codex run',
    status: 'BLOCKED with reason',
    details: [enablement.message],
  });
} else {
  const preflight = await preflightLocalCodexDogfood({
    env,
    repoPath,
    dirtyAllowlist: releaseStrictDirtyAllowlist,
  });

  if (!preflight.ok) {
    markers.push({
      marker: 'Strict local_codex run',
      status: 'BLOCKED with reason',
      details: sanitizeStrictPreflightBlockerDetails(preflight),
    });
  } else {
    // create and run local_codex package
  }
}
```

Use `evaluateLocalCodexDogfoodEnablement` before `preflightLocalCodexDogfood`. Do not create or run a real `local_codex` package unless `FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1` is set. Use `sanitizeStrictPreflightBlockerDetails(preflight)` from Task 2 for report details. If the helper currently has a fixed P0 dirty allowlist, extend it with an optional `dirtyAllowlist` parameter before this step.

- [ ] **Step 5: Create and run the bounded local_codex package**

Add a Release-specific package builder in `scripts/dogfood/release-flow-core.ts`:

```ts
export const buildReleaseLocalCodexPackageInput = (input: {
  repoPath: string;
  baseCommitSha: string;
  actorOwner: string;
  actorReviewer: string;
  actorQa: string;
}) => ({
  repo_id: 'forgeloop-source',
  objective: 'Append a short Release strict dogfood marker line to README.md only. Do not edit files outside README.md.',
  owner_actor_id: input.actorOwner,
  reviewer_actor_id: input.actorReviewer,
  qa_owner_actor_id: input.actorQa,
  required_checks: [
    {
      check_id: 'release-strict-local-codex',
      display_name: 'Release strict local Codex required check',
      command: 'node -e "process.exit(0)"',
      timeout_seconds: 30,
      blocks_review: true,
    },
  ],
  required_artifact_kinds: ['execution_summary', 'diff', 'changed_files', 'check_output', 'review_packet'],
  allowed_paths: ['README.md'],
  forbidden_paths: ['.git', '.env', 'node_modules'],
});
```

Use public API to:

1. Create a second ExecutionPackage from the approved plan revision.
2. Mark it ready.
3. Run it with `{ executor_type: 'local_codex', workflow_only: false }` and `X-Forgeloop-Actor-Id`.
4. Poll to terminal.
5. Validate internal runtime metadata, terminal evidence, and at least one public non-terminal live event observed before terminal completion with shared strict helpers.
6. Fetch the generated ReviewPacket for the terminal run and approve it through `POST /review-packets/:reviewPacketId/approve` with the seeded reviewer actor:

```ts
await request(server)
  .post(`/review-packets/${reviewPacketId}/approve`)
  .set('X-Forgeloop-Actor-Id', actorReviewer)
  .send({
    summary: 'Strict local Codex dogfood evidence approved.',
    reviewed_by_actor_id: actorReviewer,
    reviewed_at: nowIso(),
  })
  .expect(201);
```

7. Re-fetch the strict local Codex ExecutionPackage and assert it is release-ready before linking:

```ts
expect(strictPackage.phase).toBe('release');
expect(strictPackage.gate_state).toBe('release_ready');
expect(strictPackage.resolution).toBe('completed');
```

8. Link the completed, review-approved package to the Release while Release is still `draft` or `candidate`.
9. Add observation evidence later with public-safe strict summary and links.

Strict `PASSED` requires all of these checks:

- run status is `succeeded`;
- the poll observed at least one public non-terminal live event such as `run_queued`, `run_started`, live Codex progress, or equivalent public run event before terminal completion;
- terminal changed files, check results, artifacts, Review Packet availability, Review Packet approval, release-ready package state, and internal runtime metadata all satisfy the strict helper assertions;
- no report/cockpit/replay public projection leaks unsafe fields.

If local Codex reaches a failed terminal status, terminal evidence is missing, live progress is never observed, Review Packet approval fails, the package never reaches release-ready, or public projection safety fails, catch the error, sanitize details, return all required markers, and set `Strict local_codex run` to `FAILED`. Do not throw past report rendering for these expected strict assertion failures.

- [ ] **Step 6: Replace the durable no-op worker with a real worker path for strict runs**

Do not run strict `local_codex` through the no-op worker from Task 4. Add a strict-mode app boot path that uses the real `RUN_WORKER` provider from `P0Module`, or explicitly constructs and injects a real `RunWorker` with:

- Drizzle repository;
- `CodexAppServerDriver` / exec fallback driver path already used by `P0Module`;
- real evidence collector path from `captureLocalCodexEvidence`;
- artifact root from `FORGELOOP_EXECUTOR_ARTIFACT_ROOT` or a temp strict dogfood artifact root.

Disable `RunWorkerLifecycleService` only if the strict runner manually drains the injected real worker. If lifecycle is disabled, immediately after starting the run call:

```ts
await runWorker.drainOnce();
```

Then continue polling with an explicit deadline until terminal. If the app keeps lifecycle enabled, assert the worker is discoverable and the poll loop observes progress. The plan is not complete if the run can remain `queued` forever.

Add a bounded polling helper:

```ts
export const pollStrictLocalCodexRunToTerminal = async (input: {
  getRunSession: () => Promise<{ status: string; id: string }>;
  getPublicRunEvents: () => Promise<Array<{ event_type: string; visibility?: string }>>;
  timeoutMs: number;
  intervalMs: number;
}): Promise<{ terminal: { status: string; id: string }; observedPublicNonTerminalEvent: boolean }> => {
  const deadline = Date.now() + input.timeoutMs;
  let observedPublicNonTerminalEvent = false;
  while (Date.now() <= deadline) {
    const events = await input.getPublicRunEvents();
    observedPublicNonTerminalEvent =
      observedPublicNonTerminalEvent ||
      events.some((event) => event.visibility !== 'internal' && !/terminal|succeeded|failed|cancelled/i.test(event.event_type));
    const terminal = await input.getRunSession();
    if (['succeeded', 'failed', 'cancelled', 'timed_out'].includes(terminal.status)) {
      return { terminal, observedPublicNonTerminalEvent };
    }
    await new Promise((resolve) => setTimeout(resolve, input.intervalMs));
  }
  throw new Error('local_codex_run_terminal_timeout');
};
```

Classify `local_codex_run_terminal_timeout` as `FAILED`, not `BLOCKED`, because the run was created and the real worker path was kicked.

Add a test seam in `runStrictReleaseFlowDogfood` that proves strict mode calls a real worker drain/kick path before polling terminal evidence:

```ts
expect(realWorkerDrain).toHaveBeenCalled();
```

Add a timeout test that proves a run left in `queued` after the real worker kick cannot pass and cannot wait forever:

```ts
await expect(
  pollStrictLocalCodexRunToTerminal({
    getRunSession: async () => ({ id: 'run-1', status: 'queued' }),
    getPublicRunEvents: async () => [{ event_type: 'run_queued', visibility: 'public' }],
    timeoutMs: 1,
    intervalMs: 1,
  }),
).rejects.toThrow(/local_codex_run_terminal_timeout/);
```

Run:

```bash
pnpm vitest run tests/smoke/release-flow-dogfood-script.test.ts
```

Expected: FAIL before the strict worker path is wired, then PASS after implementation.

- [ ] **Step 7: Assert public projection after close**

After Release close, fetch:

```ts
const cockpit = await request(server).get(`/query/release-cockpit/${releaseId}`).expect(200);
const replay = await request(server).get(`/query/replay/release/${releaseId}`).expect(200);
```

Assert:

- `assertNoUnsafeReleaseDogfoodStrings('Release cockpit query', cockpit.body)`
- `assertNoUnsafeReleaseDogfoodStrings('Release replay query', replay.body)`
- strict observation links include `supports` and `generated_by`
- no public payload includes local Review Packet path or `runtime_metadata`

- [ ] **Step 8: Run blocked-mode tests without real Codex**

Run:

```bash
FORGELOOP_RELEASE_FLOW_STRICT_ALLOW_BLOCKED=1 pnpm dogfood:release-flow:strict
pnpm vitest run tests/smoke/release-flow-dogfood-script.test.ts tests/smoke/dogfood-strict-local-codex.test.ts
```

Expected:

- Strict command exits `0` only because allow-blocked is set.
- Report shows `Strict local_codex run` as `BLOCKED with reason` when Codex env is absent.
- Tests pass.

- [ ] **Step 9: Commit**

Run:

```bash
git add scripts/dogfood/release-flow-core.ts scripts/release-flow-strict-dogfood.ts tests/smoke/release-flow-dogfood-script.test.ts docs/superpowers/reports/p1-release-risk-radar-verification.md
git commit -m "test: link strict local codex evidence into release dogfood"
```

---

### Task 6: Prove Report Semantics And P0 Regression Safety

**Files:**
- Modify: `tests/smoke/release-flow-dogfood-script.test.ts`
- Modify: `tests/smoke/p0-durable-dogfood-script.test.ts`
- Modify: `tests/smoke/p0-local-codex-dogfood-script.test.ts`
- Modify: `scripts/dogfood/release-flow-core.ts`
- Modify: `scripts/dogfood/durable-postgres.ts`
- Modify: `scripts/dogfood/strict-local-codex.ts`

- [x] **Step 1: Add failure-path cleanup tests**

In `tests/smoke/release-flow-dogfood-script.test.ts`, add tests for a small cleanup helper exported from `scripts/dogfood/release-flow-core.ts`:

```ts
import { runDogfoodCleanup } from '../../scripts/dogfood/release-flow-core';

it('runs every cleanup action after a primary strict dogfood failure without hiding that failure', async () => {
  const cleanupCalls: string[] = [];
  const cleanupErrors: string[] = [];

  await expect(
    runDogfoodCleanup({
      run: async () => {
        throw new Error('primary strict dogfood failure');
      },
      cleanup: [
        { label: 'nest app', run: async () => cleanupCalls.push('nest app') },
        { label: 'db pool', run: async () => cleanupCalls.push('db pool') },
        {
          label: 'disposable database',
          run: async () => {
            cleanupCalls.push('disposable database');
            throw new Error('drop failed');
          },
        },
        { label: 'disposable container', run: async () => cleanupCalls.push('disposable container') },
        { label: 'worktree', run: async () => cleanupCalls.push('worktree') },
        { label: 'source guard', run: async () => cleanupCalls.push('source guard') },
      ],
      onCleanupError: (error) => cleanupErrors.push(error.message),
    }),
  ).rejects.toThrow('primary strict dogfood failure');

  expect(cleanupCalls).toEqual(['nest app', 'db pool', 'disposable database', 'disposable container', 'worktree', 'source guard']);
  expect(cleanupErrors).toEqual(['Cleanup disposable database failed: drop failed']);
});
```

Implement `runDogfoodCleanup` in `scripts/dogfood/release-flow-core.ts`:

```ts
export const runDogfoodCleanup = async <T>(input: {
  run: () => Promise<T>;
  cleanup: Array<{ label: string; run: () => Promise<void> }>;
  onCleanupError?: (error: Error) => void;
}): Promise<T> => {
  let result: T | undefined;
  let primaryError: unknown;
  try {
    result = await input.run();
  } catch (error) {
    primaryError = error;
  } finally {
    for (const action of input.cleanup) {
      try {
        await action.run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        input.onCleanupError?.(new Error(`Cleanup ${action.label} failed: ${message}`));
      }
    }
  }

  if (primaryError !== undefined) {
    throw primaryError;
  }
  return result as T;
};
```

Use this helper, or equivalent behavior with the same test coverage, around strict dogfood app/pool/database/container/worktree/source-guard cleanup. Cleanup errors must be reported and must not hide the primary failure.

- [x] **Step 2: Add tests for final marker/report invariants**

In `tests/smoke/release-flow-dogfood-script.test.ts`, add:

```ts
it('requires all required markers in strict reports', () => {
  expect(() => renderReleaseFlowVerificationReport([])).toThrow(/missing required marker/i);
});

it('never lets FAILED be masked by allow-blocked', () => {
  const markers = requiredReleaseFlowReportMarkers.map((marker) => ({
    marker,
    status: marker === 'Durable local reset' ? 'FAILED' : 'PASSED',
    details: ['safe'],
  }));

  expect(statusCodeForStrictReleaseMarkers(markers, { allowBlocked: true })).toBe(1);
});

it('does not allow blocked non-strict markers to exit zero', () => {
  const markers = requiredReleaseFlowReportMarkers.map((marker) => ({
    marker,
    status: marker === 'Release cockpit query' ? 'BLOCKED with reason' : 'PASSED',
    details: ['safe'],
  }));

  expect(statusCodeForStrictReleaseMarkers(markers, { allowBlocked: true })).toBe(1);
});
```

- [x] **Step 3: Add P0 regression assertions**

In `tests/smoke/p0-durable-dogfood-script.test.ts`, assert the P0 script still parses P0 reports:

```ts
expect(parseDurableDogfoodReport(reportText)).toEqual({
  dbSchemaPushPassed: true,
  durablePublicApiAuthPassed: true,
  durableSseAuthPassed: true,
  durableRepositoryRecoveryPassed: true,
});
```

In `tests/smoke/p0-local-codex-dogfood-script.test.ts`, assert existing P0 report rendering does not expose raw `workspace_path` details after helper extraction. If P0 intentionally still prints raw runtime metadata, update P0 rendering to print booleans and artifact kinds instead.

- [x] **Step 4: Run smoke helper tests**

Run:

```bash
pnpm vitest run tests/smoke/release-flow-dogfood-script.test.ts tests/smoke/dogfood-durable-postgres.test.ts tests/smoke/dogfood-strict-local-codex.test.ts tests/smoke/p0-durable-dogfood-script.test.ts tests/smoke/p0-local-codex-dogfood-script.test.ts tests/api/durable-id-generation.test.ts tests/workflow/execution-finalizer.test.ts tests/workflow/package-execution-workflow.test.ts
```

Expected: PASS.

- [x] **Step 5: Run deterministic dogfood and inspect report**

Run:

```bash
pnpm dogfood:release-flow
rg -n "Status: PASSED|Status: BLOCKED with reason|Status: FAILED" docs/superpowers/reports/p1-release-risk-radar-verification.md
rg -in "runtime_metadata|runtimeMetadata|raw_metadata|rawMetadata|database_url|databaseUrl|postgresql://|postgres://|/Users/|/home/|/workspace/|/opt/|[A-Za-z]:\\\\|\\.worktrees|allowed_paths|allowedPaths|forbidden_paths|forbiddenPaths|workspace_path|workspacePath|worktree_path|worktreePath|client_secret|clientSecret|session_secret|sessionSecret|access_token|accessToken|refresh_token|refreshToken|api_key|apiKey|authorization|password|secret|token|local_ref|localRef|artifact_path|artifactPath|/tmp/|/private/var/folders/|/var/folders/|forgeloop-executor-artifacts" docs/superpowers/reports/p1-release-risk-radar-verification.md
```

Expected:

- deterministic sections are `PASSED`;
- durable and strict sections are `BLOCKED with reason`;
- the first `rg` prints only status lines;
- the second `rg` exits `1` with no matches. If the second `rg` exits `0`, fix the report renderer before continuing.

- [x] **Step 6: Commit**

Run:

```bash
git add tests/smoke/release-flow-dogfood-script.test.ts tests/smoke/p0-durable-dogfood-script.test.ts tests/smoke/p0-local-codex-dogfood-script.test.ts scripts/dogfood/release-flow-core.ts scripts/dogfood/durable-postgres.ts scripts/dogfood/strict-local-codex.ts docs/superpowers/reports/p1-release-risk-radar-verification.md
git commit -m "test: enforce release dogfood report semantics"
```

---

### Task 7: Run Strict Durable And Local Codex Dogfood Closure

**Files:**
- Modify: `docs/superpowers/reports/p1-release-risk-radar-verification.md`
- Potentially modify implementation files only if this task exposes bugs.

- [x] **Step 1: Run strict closure with disposable Postgres and blocked Codex allowed**

Run:

```bash
FORGELOOP_DOGFOOD_START_POSTGRES=1 FORGELOOP_RELEASE_FLOW_STRICT_ALLOW_BLOCKED=1 pnpm dogfood:release-flow:strict
```

Expected:

- command exits `0`;
- `Durable local reset` is `PASSED` if Docker can start Postgres;
- `Strict local_codex run` may be `BLOCKED with reason` if real Codex env is absent;
- report contains no unsafe strings.

If Docker is unavailable, run with a safe local test DB:

```bash
FORGELOOP_DATABASE_URL="postgresql://forgeloop:forgeloop@127.0.0.1:5432/forgeloop_tmp_release_dogfood" FORGELOOP_RELEASE_FLOW_STRICT_ALLOW_BLOCKED=1 pnpm dogfood:release-flow:strict
```

Expected: same as above.

- [x] **Step 2: Run strict closure with real local Codex enabled**

Run only when the local Codex runtime is authenticated and the checkout is clean:

```bash
FORGELOOP_DOGFOOD_START_POSTGRES=1 \
FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 \
FORGELOOP_LOCAL_CODEX_DOGFOOD_CONFIRM_DANGEROUS_MODE=1 \
pnpm dogfood:release-flow:strict
```

Expected:

- command exits `0`;
- `Durable local reset` is `PASSED`;
- `Strict local_codex run` is `PASSED`;
- report contains strict local Codex evidence summary but no raw local paths or runtime metadata.

If this is blocked by environment, do not mark the task complete. Record the blocker in the report and tell the user what is missing.

- [x] **Step 3: Verify report safety**

Run:

```bash
rg -in "runtime_metadata|runtimeMetadata|raw_metadata|rawMetadata|database_url|databaseUrl|postgresql://|postgres://|/Users/|/home/|/workspace/|/opt/|[A-Za-z]:\\\\|\\.worktrees|allowed_paths|allowedPaths|forbidden_paths|forbiddenPaths|workspace_path|workspacePath|worktree_path|worktreePath|client_secret|clientSecret|session_secret|sessionSecret|access_token|accessToken|refresh_token|refreshToken|api_key|apiKey|authorization|password|secret|token|local_ref|localRef|artifact_path|artifactPath|/tmp/|/private/var/folders/|/var/folders/|forgeloop-executor-artifacts" docs/superpowers/reports/p1-release-risk-radar-verification.md
```

Expected: no matches. `rg` should exit `1`.

- [x] **Step 4: Commit report update**

Run:

```bash
git add docs/superpowers/reports/p1-release-risk-radar-verification.md
git commit -m "test: verify release strict dogfood closure"
```

Only commit this when the report honestly reflects what ran. If strict local Codex remains blocked, the commit message should be:

```bash
git commit -m "docs: record blocked release strict dogfood closure"
```

---

### Task 8: Final Verification

**Files:**
- Modify only files required to fix failures discovered here.

- [x] **Step 1: Run focused smoke/API tests**

Run:

```bash
pnpm vitest run tests/smoke/release-flow-dogfood-script.test.ts tests/smoke/dogfood-durable-postgres.test.ts tests/smoke/dogfood-strict-local-codex.test.ts tests/smoke/p0-durable-dogfood-script.test.ts tests/smoke/p0-local-codex-dogfood-script.test.ts tests/api/durable-id-generation.test.ts tests/workflow/execution-finalizer.test.ts tests/workflow/package-execution-workflow.test.ts tests/api/release-module.test.ts tests/api/query-module.test.ts
```

Expected: PASS.

- [x] **Step 2: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS. The known Nest negative-path log about `FORGELOOP_DEV_AUTH_SECRET` may appear if existing tests trigger it, but the command must exit `0`.

- [x] **Step 3: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [x] **Step 4: Run deterministic Release dogfood without overwriting final strict evidence**

Run:

```bash
FORGELOOP_RELEASE_FLOW_DOGFOOD_REPORT_PATH=/tmp/forgeloop-release-flow-deterministic-verification.md pnpm dogfood:release-flow
```

Expected: exits `0` and writes a deterministic report to `/tmp/forgeloop-release-flow-deterministic-verification.md`. Do not overwrite `docs/superpowers/reports/p1-release-risk-radar-verification.md` after Task 7 has produced strict PASS evidence. If the final tracked report was overwritten accidentally, rerun Task 7 before claiming closure.

- [x] **Step 5: Inspect final report markers**

Run:

```bash
sed -n '1,140p' docs/superpowers/reports/p1-release-risk-radar-verification.md
```

Expected: report matches the most recent intentionally run dogfood mode. Do not claim strict closure if either strict closure marker is `BLOCKED with reason`.

- [x] **Step 6: Check git status**

Run:

```bash
git status --short --branch
```

Expected: clean worktree.

- [x] **Step 7: Final commit if needed**

If verification produced final report changes:

```bash
git add docs/superpowers/reports/p1-release-risk-radar-verification.md
git commit -m "docs: refresh release dogfood verification"
```

Expected: commit succeeds and status is clean.
