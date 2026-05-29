# Codex Runtime Real Dogfood Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing strict Codex runtime Superpowers dogfood into a real state-driven Codex app-server pass that validates Codex-led Boundary Brainstorming, stale gates, Spec generation, Execution Plan generation, and Execution without worker-local Codex config.

**Architecture:** Keep `pnpm dogfood:codex-runtime:superpowers` as the canonical package entrypoint and replace its fixed `round 1 -> answer -> round 2 -> summary` orchestration with a Boundary session state loop. The HTTP dogfood client drives current product APIs, records anti-two-round evidence, and writes a single public-safe report at `docs/superpowers/reports/codex-runtime-real-dogfood-pass.md`.

**Tech Stack:** TypeScript, pnpm, Vitest, NestJS control-plane APIs, ForgeLoop runtime/profile/worker packages, Dockerized Codex app-server.

---

## Scope Check

This plan implements one slice from `docs/superpowers/specs/2026-05-28-codex-runtime-real-dogfood-pass-design.md`: the real dogfood pass. It does not add a UI, dual-machine deployment workflow, external secret manager, or a new worker platform.

The package script remains `dogfood:codex-runtime:superpowers` because `package.json`, `docs/runbooks/codex-remote-worker-runtime.md`, and `scripts/check-runbook-scripts.ts` already agree on that name. The implementation changes what that command proves.

## Current API Route Map

Use these existing routes. Do not invent new route names unless a test proves one is missing.

- Start Boundary Brainstorming: `POST /development-plans/:developmentPlanId/items/:itemId/boundary-brainstorming`
- Restart Boundary Brainstorming: `POST /development-plans/:developmentPlanId/items/:itemId/boundary-brainstorming/restart`
- Fetch Boundary session: `GET /boundary-brainstorming-sessions/:sessionId`
- Answer Boundary question: `POST /boundary-brainstorming-sessions/:sessionId/answers`
- Record Boundary decision: `POST /boundary-brainstorming-sessions/:sessionId/decisions`
- Continue Boundary session: `POST /boundary-brainstorming-sessions/:sessionId/continue`
- Request Boundary Summary changes: `POST /boundary-brainstorming-sessions/:sessionId/summary-revisions/:revisionId/request-changes`
- Approve Boundary Summary revision: `POST /boundary-brainstorming-sessions/:sessionId/summary-revisions/:revisionId/approve`
- Generate Spec revision: `POST /development-plans/:developmentPlanId/items/:itemId/spec-revisions/generate`
- Generate Execution Plan revision: `POST /development-plans/:developmentPlanId/items/:itemId/execution-plan-revisions/generate`
- Start Execution: `POST /development-plans/:developmentPlanId/items/:itemId/execution/start`

## File Structure

- Modify `scripts/codex-runtime-superpowers-dogfood.ts`
  - Owns CLI config parsing, strict dogfood client interface, state-driven orchestration, HTTP route calls, worker polling, and report rendering.
- Modify `tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts`
  - Owns TDD coverage for orchestration order, Boundary state loop, request-changes path, report schema, public-safety redaction, env scrub, stale gate, and execution evidence.
- Modify `docs/runbooks/codex-remote-worker-runtime.md`
  - Documents that `pnpm dogfood:codex-runtime:superpowers` is now the real state-driven dogfood pass and lists its public-safe report output.
- Modify `scripts/check-codex-runtime-superpowers-no-baggage.ts` only if the new report path or new public-safe evidence fields need allowlist changes.
- Modify `package.json` only if the existing script alias is missing or must point to a renamed script. Prefer no `package.json` change.

## Implementation Notes

The current dogfood test asserts:

```ts
expect(calls).toEqual([
  'seedSourceAndDevelopmentPlanItem',
  'importCodexRuntime',
  'smokeGenerationWorker',
  'startNoSharedFilesystemRunWorker',
  'runBoundaryBrainstormingRound:1',
  'answerBoundaryQuestion',
  'runBoundaryBrainstormingRound:2',
  'proposeBoundarySummary',
  'mutateDevelopmentPlanItem',
  'assertStaleBoundaryBlocksSpecGeneration',
  'rebaseBoundaryBrainstorming',
  'approveBoundarySummary',
  'generateAndApproveSpec',
  'generateAndApproveExecutionPlan',
  'startExecution',
  'writeReport',
]);
```

That is the first failing assertion to replace. The new top-level orchestration should read more like:

```ts
expect(calls).toEqual([
  'seedSourceAndDevelopmentPlanItem',
  'importCodexRuntime',
  'smokeGenerationWorker',
  'startNoSharedFilesystemRunWorker',
  'completeBoundaryBrainstorming:initial',
  'mutateDevelopmentPlanItem',
  'assertStaleBoundaryBlocksSpecGeneration',
  'completeBoundaryBrainstorming:rebase',
  'generateAndApproveSpec',
  'generateAndApproveExecutionPlan',
  'startExecution',
  'writeReport',
]);
```

The detailed state-loop behavior is tested through the HTTP client tests, not hidden behind the top-level mock.

## Task 1: Extend Runtime Evidence Types, Report Schema, And Public-Safe Output

**Files:**
- Modify: `tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts`
- Modify: `scripts/codex-runtime-superpowers-dogfood.ts`

- [ ] **Step 1: Write the failing report schema test**

In `tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts`, update `renders a public-safe report with product object names and digests only` so the report input includes these new fields:

```ts
package_script_command: 'pnpm dogfood:codex-runtime:superpowers',
codex_app_server_evidence: {
  mode: 'dockerized_app_server',
  output_schema_versions: ['boundary_round_result.v1', 'spec_revision.v1', 'execution_plan_revision.v1', 'codex_run_execution_result.v1'],
  runtime_job_digests: [digest('r')],
  app_server_evidence_digests: [digest('app-server-r')],
  phases: [
    {
      phase: 'boundary_initial',
      expected_output_schema_version: 'boundary_round_result.v1',
      observed_output_schema_versions: ['boundary_round_result.v1'],
      runtime_job_digests: [digest('boundary-a')],
      app_server_evidence_digests: [digest('boundary-app-server-a')],
      cleanup_status: 'completed',
    },
    {
      phase: 'boundary_rebase',
      expected_output_schema_version: 'boundary_round_result.v1',
      observed_output_schema_versions: ['boundary_round_result.v1'],
      runtime_job_digests: [digest('boundary-rebase-a')],
      app_server_evidence_digests: [digest('boundary-rebase-app-server-a')],
      cleanup_status: 'completed',
    },
    {
      phase: 'spec',
      expected_output_schema_version: 'spec_revision.v1',
      observed_output_schema_versions: ['spec_revision.v1'],
      runtime_job_digests: [digest('spec-a')],
      app_server_evidence_digests: [digest('spec-app-server-a')],
      cleanup_status: 'completed',
    },
    {
      phase: 'execution_plan',
      expected_output_schema_version: 'execution_plan_revision.v1',
      observed_output_schema_versions: ['execution_plan_revision.v1'],
      runtime_job_digests: [digest('plan-a')],
      app_server_evidence_digests: [digest('plan-app-server-a')],
      cleanup_status: 'completed',
    },
    {
      phase: 'execution',
      expected_output_schema_version: 'codex_run_execution_result.v1',
      observed_output_schema_versions: ['codex_run_execution_result.v1'],
      runtime_job_digests: [digest('execution-a')],
      app_server_evidence_digests: [digest('execution-app-server-a')],
      cleanup_status: 'completed',
    },
  ],
},
boundary_ai_turn_count: 4,
boundary_follow_up_path_covered: true,
boundary_summary_request_change_path_covered: true,
cleanup_status: 'completed',
report_path: 'docs/superpowers/reports/codex-runtime-real-dogfood-pass.md',
```

- [ ] **Step 1a: Add runtime evidence to all mocked phase results**

In the same test fixture file, define all phase result fixtures with runtime job digests before any orchestration test consumes them:

```ts
const boundaryEvidence = {
  mode: 'initial' as const,
  session_id: 'boundary-session-initial',
  approved_summary_revision_id: 'boundary-summary-revision-initial',
  ai_turn_count: 3,
  follow_up_path_covered: true,
  summary_request_change_path_covered: true,
  output_schema_versions: ['boundary_round_result.v1'],
  app_server_evidence_digests: [digest('boundary-app-server-a')],
  runtime_job_digests: [digest('boundary-a'), digest('boundary-b'), digest('boundary-c')],
  cleanup_status: 'completed' as const,
};

const specEvidence = {
  spec_revision_id: 'spec-revision-1',
  output_schema_versions: ['spec_revision.v1'],
  app_server_evidence_digests: [digest('spec-app-server-a')],
  runtime_job_digests: [digest('spec-a')],
  cleanup_status: 'completed' as const,
};

const executionPlanEvidence = {
  execution_plan_revision_id: 'execution-plan-revision-1',
  output_schema_versions: ['execution_plan_revision.v1'],
  app_server_evidence_digests: [digest('plan-app-server-a')],
  runtime_job_digests: [digest('plan-a')],
  cleanup_status: 'completed' as const,
};

const executionEvidence = {
  execution_id: 'execution-1',
  workspace_bundle_digest: digest('workspace-bundle'),
  mounted_task_workspace_digest: digest('mounted-task-workspace'),
  changed_files: ['docs/superpowers/reports/codex-runtime-real-dogfood-pass.md'],
  output_schema_versions: ['codex_run_execution_result.v1'],
  app_server_evidence_digests: [digest('execution-app-server-a')],
  runtime_job_digests: [digest('execution-a')],
  cleanup_status: 'completed' as const,
};
```

Every test double for `completeBoundaryBrainstorming`, `generateAndApproveSpec`, `generateAndApproveExecutionPlan`, and `startExecution` must return these fields from Task 1 onward. Do not introduce temporary empty runtime or app-server evidence arrays in later tasks.

Add assertions:

```ts
expect(markdown).toContain('Command: pnpm dogfood:codex-runtime:superpowers');
expect(markdown).toContain('Codex app-server mode: dockerized_app_server');
expect(markdown).toContain('Boundary AI turns: 4');
expect(markdown).toContain('Follow-up path covered: true');
expect(markdown).toContain('Summary request-change path covered: true');
expect(markdown).toContain('Cleanup status: completed');
expect(markdown).not.toContain('localhost');
expect(markdown).not.toContain('container');
```

Also update the unsafe-report test to verify these fields reject unsafe raw endpoints or path-looking values:

```ts
expect(() =>
  renderCodexRuntimeSuperpowersDogfoodReport({
    ...safeReport,
    codex_app_server_evidence: {
      ...safeReport.codex_app_server_evidence,
      runtime_job_digests: ['http://127.0.0.1:1234'],
    },
  }),
).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);

expect(() =>
  renderCodexRuntimeSuperpowersDogfoodReport({
    ...safeReport,
    codex_app_server_evidence: {
      ...safeReport.codex_app_server_evidence,
      app_server_evidence_digests: ['container-123'],
    },
  }),
).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because `CodexRuntimeSuperpowersDogfoodReport` and `renderCodexRuntimeSuperpowersDogfoodReport` do not yet support the new evidence fields.

- [ ] **Step 3: Extend the report types**

In `scripts/codex-runtime-superpowers-dogfood.ts`, add:

```ts
type BoundaryCoverageMode = 'initial' | 'rebase';

export interface CodexRuntimeBoundaryDogfoodEvidence {
  mode: BoundaryCoverageMode;
  session_id: string;
  approved_summary_revision_id: string;
  ai_turn_count: number;
  follow_up_path_covered: boolean;
  summary_request_change_path_covered: boolean;
  output_schema_versions: string[];
  app_server_evidence_digests: Sha256Digest[];
  runtime_job_digests: Sha256Digest[];
  cleanup_status: 'completed' | 'blocked';
}

export interface CodexRuntimeAppServerEvidence {
  mode: 'dockerized_app_server';
  output_schema_versions: string[];
  runtime_job_digests: Sha256Digest[];
  app_server_evidence_digests: Sha256Digest[];
  phases: Array<{
    phase: 'boundary_initial' | 'boundary_rebase' | 'spec' | 'execution_plan' | 'execution';
    expected_output_schema_version: string;
    observed_output_schema_versions: string[];
    runtime_job_digests: Sha256Digest[];
    app_server_evidence_digests: Sha256Digest[];
    cleanup_status: 'completed';
  }>;
}
```

Extend the generation and execution result types before top-level orchestration consumes them:

```ts
export interface CodexRuntimeSpecDogfoodEvidence {
  spec_revision_id: string;
  output_schema_versions: string[];
  app_server_evidence_digests: Sha256Digest[];
  runtime_job_digests: Sha256Digest[];
  cleanup_status: 'completed' | 'blocked';
}

export interface CodexRuntimeExecutionPlanDogfoodEvidence {
  execution_plan_revision_id: string;
  output_schema_versions: string[];
  app_server_evidence_digests: Sha256Digest[];
  runtime_job_digests: Sha256Digest[];
  cleanup_status: 'completed' | 'blocked';
}

export interface CodexRuntimeExecutionDogfoodEvidence {
  execution_id: string;
  workspace_bundle_digest: Sha256Digest;
  mounted_task_workspace_digest: Sha256Digest;
  changed_files: string[];
  output_schema_versions: string[];
  app_server_evidence_digests: Sha256Digest[];
  runtime_job_digests: Sha256Digest[];
  cleanup_status: 'completed' | 'blocked';
}
```

Update `CodexRuntimeSuperpowersDogfoodClient` in the same step:

```ts
completeBoundaryBrainstorming: (mode: 'initial' | 'rebase') => Promise<CodexRuntimeBoundaryDogfoodEvidence>;
generateAndApproveSpec: () => Promise<CodexRuntimeSpecDogfoodEvidence>;
generateAndApproveExecutionPlan: () => Promise<CodexRuntimeExecutionPlanDogfoodEvidence>;
startExecution: () => Promise<CodexRuntimeExecutionDogfoodEvidence>;
```

Extend `CodexRuntimeSuperpowersDogfoodReport`:

```ts
package_script_command: 'pnpm dogfood:codex-runtime:superpowers';
codex_app_server_evidence: CodexRuntimeAppServerEvidence;
boundary_ai_turn_count: number;
boundary_follow_up_path_covered: boolean;
boundary_summary_request_change_path_covered: boolean;
cleanup_status: 'completed' | 'blocked';
report_path: 'docs/superpowers/reports/codex-runtime-real-dogfood-pass.md';
```

- [ ] **Step 4: Render and validate the new fields**

Update `renderCodexRuntimeSuperpowersDogfoodReport`:

```ts
for (const digest of report.codex_app_server_evidence.runtime_job_digests) {
  assertSha256Digest(digest, 'codex_app_server_runtime_job_digest');
}
for (const digest of report.codex_app_server_evidence.app_server_evidence_digests) {
  assertSha256Digest(digest, 'codex_app_server_evidence_digest');
}
for (const schemaVersion of report.codex_app_server_evidence.output_schema_versions) {
  assertPublicSafeId(schemaVersion, 'codex_app_server_output_schema_version');
}
for (const phase of report.codex_app_server_evidence.phases) {
  assertPublicSafeId(phase.phase, 'codex_app_server_phase');
  assertPublicSafeId(phase.expected_output_schema_version, 'codex_app_server_phase_schema');
  for (const schemaVersion of phase.observed_output_schema_versions) {
    assertPublicSafeId(schemaVersion, 'codex_app_server_phase_observed_schema');
  }
  for (const digest of phase.runtime_job_digests) {
    assertSha256Digest(digest, 'codex_app_server_phase_runtime_job_digest');
  }
  for (const digest of phase.app_server_evidence_digests) {
    assertSha256Digest(digest, 'codex_app_server_phase_evidence_digest');
  }
}
```

Add lines:

```ts
`- Command: ${report.package_script_command}`,
`- Codex app-server mode: ${report.codex_app_server_evidence.mode}`,
`- Codex output schemas: ${report.codex_app_server_evidence.output_schema_versions.join(', ')}`,
`- Codex runtime job digests: ${report.codex_app_server_evidence.runtime_job_digests.join(', ')}`,
`- Codex app-server evidence digests: ${report.codex_app_server_evidence.app_server_evidence_digests.join(', ')}`,
...report.codex_app_server_evidence.phases.map(
  (phase) =>
    `- Phase ${phase.phase}: expected_schema=${phase.expected_output_schema_version} observed_schemas=${phase.observed_output_schema_versions.join(', ')} cleanup=${phase.cleanup_status} runtime_jobs=${phase.runtime_job_digests.join(', ')} app_server=${phase.app_server_evidence_digests.join(', ')}`,
),
`- Boundary AI turns: ${report.boundary_ai_turn_count}`,
`- Follow-up path covered: ${String(report.boundary_follow_up_path_covered)}`,
`- Summary request-change path covered: ${String(report.boundary_summary_request_change_path_covered)}`,
`- Cleanup status: ${report.cleanup_status}`,
```

If `assertSha256Digest` does not exist, add:

```ts
const assertSha256Digest = (value: string, label: string): asserts value is Sha256Digest => {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`codex_runtime_superpowers_dogfood_report_unsafe:${label}`);
  }
};
```

- [ ] **Step 5: Use the fixed report path**

Change `FilesystemCodexRuntimeSuperpowersDogfoodReporter.write` to always write:

```ts
const reportPath = join('docs', 'superpowers', 'reports', 'codex-runtime-real-dogfood-pass.md');
```

Keep validating `execution_id` and changed files, but stop deriving the report filename from `execution_id`.

- [ ] **Step 6: Run the focused test and verify it passes**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS for the report tests. If unrelated tests in the same file now fail because they construct `safeReport`, update those fixtures to include the new required fields.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add scripts/codex-runtime-superpowers-dogfood.ts tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts
git commit -m "test: require real codex dogfood runtime evidence"
```

## Task 2: Replace Fixed-Round Top-Level Orchestration

**Files:**
- Modify: `tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts`
- Modify: `scripts/codex-runtime-superpowers-dogfood.ts`

- [ ] **Step 1: Write the failing top-level orchestration test**

In `tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts`, update the first test client interface to remove:

```ts
runBoundaryBrainstormingRound
answerBoundaryQuestion
proposeBoundarySummary
rebaseBoundaryBrainstorming
approveBoundarySummary
```

Add:

```ts
completeBoundaryBrainstorming: vi.fn(async (mode: 'initial' | 'rebase') => {
  calls.push(`completeBoundaryBrainstorming:${mode}`);
  return {
    mode,
    session_id: mode === 'initial' ? 'boundary-session-initial' : 'boundary-session-rebased',
    approved_summary_revision_id: mode === 'initial' ? 'boundary-summary-revision-initial' : 'boundary-summary-revision-rebased',
    ai_turn_count: mode === 'initial' ? 3 : 2,
    follow_up_path_covered: mode === 'initial',
    summary_request_change_path_covered: mode === 'initial',
    output_schema_versions: ['boundary_round_result.v1'],
    app_server_evidence_digests:
      mode === 'initial' ? [digest('boundary-initial-app-server')] : [digest('boundary-rebase-app-server')],
    runtime_job_digests:
      mode === 'initial'
        ? [digest('boundary-initial-a'), digest('boundary-initial-b'), digest('boundary-initial-c')]
        : [digest('boundary-rebase-a'), digest('boundary-rebase-b')],
    cleanup_status: 'completed',
  };
}),
```

Update the mocked generation and execution methods in the same test to return the Task 1 evidence fields:

```ts
generateAndApproveSpec: vi.fn(async () => {
  calls.push('generateAndApproveSpec');
  return specEvidence;
}),
generateAndApproveExecutionPlan: vi.fn(async () => {
  calls.push('generateAndApproveExecutionPlan');
  return executionPlanEvidence;
}),
startExecution: vi.fn(async () => {
  calls.push('startExecution');
  return executionEvidence;
}),
```

Change the expected call order to:

```ts
expect(calls).toEqual([
  'seedSourceAndDevelopmentPlanItem',
  'importCodexRuntime',
  'smokeGenerationWorker',
  'startNoSharedFilesystemRunWorker',
  'completeBoundaryBrainstorming:initial',
  'mutateDevelopmentPlanItem',
  'assertStaleBoundaryBlocksSpecGeneration',
  'completeBoundaryBrainstorming:rebase',
  'generateAndApproveSpec',
  'generateAndApproveExecutionPlan',
  'startExecution',
  'writeReport',
]);
```

Assert the report aggregates evidence:

```ts
expect(result.report).toMatchObject({
  boundary_brainstorming_session_id: 'boundary-session-rebased',
  boundary_summary_revision_id: 'boundary-summary-revision-rebased',
  boundary_ai_turn_count: 5,
  boundary_follow_up_path_covered: true,
  boundary_summary_request_change_path_covered: true,
  report_path: 'docs/superpowers/reports/codex-runtime-real-dogfood-pass.md',
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because `CodexRuntimeSuperpowersDogfoodClient` still exposes fixed round methods and `runCodexRuntimeSuperpowersDogfood` still calls them.

- [ ] **Step 3: Update the client interface**

In `scripts/codex-runtime-superpowers-dogfood.ts`, replace the fixed Boundary methods in `CodexRuntimeSuperpowersDogfoodClient` with:

```ts
completeBoundaryBrainstorming: (mode: 'initial' | 'rebase') => Promise<CodexRuntimeBoundaryDogfoodEvidence>;
```

Keep:

```ts
mutateDevelopmentPlanItem
assertStaleBoundaryBlocksSpecGeneration
generateAndApproveSpec
generateAndApproveExecutionPlan
startExecution
writeReport
```

- [ ] **Step 4: Update top-level orchestration**

Replace:

```ts
await input.client.runBoundaryBrainstormingRound(1);
await input.client.answerBoundaryQuestion();
await input.client.runBoundaryBrainstormingRound(2);
await input.client.proposeBoundarySummary();
await input.client.mutateDevelopmentPlanItem();
const staleBoundaryCheck = await input.client.assertStaleBoundaryBlocksSpecGeneration();
const rebasedBoundary = await input.client.rebaseBoundaryBrainstorming();
const approvedBoundary = await input.client.approveBoundarySummary();
```

With:

```ts
const initialBoundary = await input.client.completeBoundaryBrainstorming('initial');
await input.client.mutateDevelopmentPlanItem();
const staleBoundaryCheck = await input.client.assertStaleBoundaryBlocksSpecGeneration();
const rebasedBoundary = await input.client.completeBoundaryBrainstorming('rebase');
```

Build report values:

```ts
const boundaryAiTurnCount = initialBoundary.ai_turn_count + rebasedBoundary.ai_turn_count;
const followUpCovered = initialBoundary.follow_up_path_covered || rebasedBoundary.follow_up_path_covered;
const requestChangeCovered =
  initialBoundary.summary_request_change_path_covered || rebasedBoundary.summary_request_change_path_covered;

if (!followUpCovered || !requestChangeCovered) {
  throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_boundary_coverage_missing', {
    status: 'BLOCKED',
    blocker_code: 'codex_runtime_superpowers_boundary_coverage_missing',
  });
}
```

Use `rebasedBoundary.session_id` and `rebasedBoundary.approved_summary_revision_id` as the final Boundary evidence.

- [ ] **Step 5: Refactor stale-mutation helper to stop re-approving the initial summary**

The existing `mutateDevelopmentPlanItem()` approves the Boundary Summary internally before patching the item. After `completeBoundaryBrainstorming('initial')` owns summary approval, that old behavior will try to approve an already-approved revision and can fail against the product API.

Change `mutateDevelopmentPlanItem()` so it only verifies the initial summary id is known, then patches the Development Plan Item:

```ts
async mutateDevelopmentPlanItem() {
  const planId = requireState(developmentPlanId, 'codex_runtime_superpowers_dogfood_plan_missing');
  const itemId = requireState(developmentPlanItemId, 'codex_runtime_superpowers_dogfood_item_missing');
  requireState(boundarySummaryRevisionId, 'codex_runtime_superpowers_dogfood_boundary_summary_revision_id_missing');

  await requestJson(config, `/development-plans/${planId}/items/${itemId}`, {
    method: 'PATCH',
    body: {
      actor_id: config.leaderActorId,
      summary:
        'Validate the Superpowers product loop through centralized Codex runtime distribution after stale-boundary negative evidence.',
    },
  }, fetchDeps);
}
```

Add a focused assertion to the top-level orchestration test that no second approve call happens before mutation. If using request-level HTTP tests, assert the stale-mutation flow calls:

```ts
POST /boundary-brainstorming-sessions/boundary-session-initial/summary-revisions/boundary-summary-revision-initial/approve
PATCH /development-plans/development-plan-1/items/item-1
```

and does not call the approve route again during `mutateDevelopmentPlanItem()`.

- [ ] **Step 6: Derive app-server report evidence from runtime phase results**

When constructing the report, first collect public-safe app-server phase evidence from the runtime-backed phase results, then derive the PASS-only app-server evidence from those observed records. Add helpers near report construction:

```ts
export interface CodexRuntimeDogfoodPhaseEvidence {
  phase: 'boundary_initial' | 'boundary_rebase' | 'spec' | 'execution_plan' | 'execution';
  expected_output_schema_version: string;
  observed_output_schema_versions: string[];
  runtime_job_digests: Sha256Digest[];
  app_server_evidence_digests: Sha256Digest[];
  cleanup_status: 'completed' | 'blocked';
}

const collectCodexAppServerPhaseEvidence = (input: {
  boundary: CodexRuntimeBoundaryDogfoodEvidence[];
  spec: CodexRuntimeSpecDogfoodEvidence;
  executionPlan: CodexRuntimeExecutionPlanDogfoodEvidence;
  execution: CodexRuntimeExecutionDogfoodEvidence;
}): CodexRuntimeDogfoodPhaseEvidence[] => {
  return [
    {
      phase: 'boundary_initial' as const,
      expected_output_schema_version: 'boundary_round_result.v1',
      evidence: input.boundary.find((boundary) => boundary.mode === 'initial'),
    },
    {
      phase: 'boundary_rebase' as const,
      expected_output_schema_version: 'boundary_round_result.v1',
      evidence: input.boundary.find((boundary) => boundary.mode === 'rebase'),
    },
    { phase: 'spec' as const, expected_output_schema_version: 'spec_revision.v1', evidence: input.spec },
    {
      phase: 'execution_plan' as const,
      expected_output_schema_version: 'execution_plan_revision.v1',
      evidence: input.executionPlan,
    },
    { phase: 'execution' as const, expected_output_schema_version: 'codex_run_execution_result.v1', evidence: input.execution },
  ].map((phase) => {
    const evidence = phase.evidence;
    if (evidence === undefined) {
      throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_app_server_phase_evidence_missing', {
        status: 'BLOCKED',
        blocker_code: 'codex_runtime_superpowers_app_server_phase_evidence_missing',
      });
    }
    return {
      phase: phase.phase,
      expected_output_schema_version: phase.expected_output_schema_version,
      observed_output_schema_versions: evidence.output_schema_versions,
      runtime_job_digests: evidence.runtime_job_digests,
      app_server_evidence_digests: evidence.app_server_evidence_digests,
      cleanup_status: evidence.cleanup_status,
    };
  });
};

const deriveCodexAppServerEvidence = (phases: CodexRuntimeDogfoodPhaseEvidence[]): CodexRuntimeAppServerEvidence => {
  const invalidPhase = phases.find(
    (phase) =>
      phase.runtime_job_digests.length === 0 ||
      phase.app_server_evidence_digests.length === 0 ||
      !phase.observed_output_schema_versions.includes(phase.expected_output_schema_version) ||
      phase.cleanup_status !== 'completed',
  );

  if (invalidPhase !== undefined) {
    throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_app_server_phase_evidence_missing', {
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_app_server_phase_evidence_missing',
      cleanup_status: invalidPhase.cleanup_status === 'blocked' ? 'blocked' : 'completed',
      codex_app_server_evidence: {
        phases,
      },
    });
  }

  const runtimeJobDigests = [
    ...phases.flatMap((phase) => phase.runtime_job_digests),
  ];
  const appServerEvidenceDigests = [
    ...phases.flatMap((phase) => phase.app_server_evidence_digests),
  ];
  const outputSchemaVersions = [
    ...phases.flatMap((phase) => phase.observed_output_schema_versions),
  ];

  if (runtimeJobDigests.length === 0 || outputSchemaVersions.length === 0 || appServerEvidenceDigests.length === 0) {
    throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_app_server_evidence_missing', {
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_app_server_evidence_missing',
    });
  }

  return {
    mode: 'dockerized_app_server',
    output_schema_versions: Array.from(new Set(outputSchemaVersions)),
    runtime_job_digests: Array.from(new Set(runtimeJobDigests)),
    app_server_evidence_digests: Array.from(new Set(appServerEvidenceDigests)),
    phases: phases.map((phase) => ({
      ...phase,
      cleanup_status: 'completed' as const,
    })),
  };
};
```

The helper may use the literal `dockerized_app_server` mode only after every required phase has non-empty runtime job digests, the expected output schema version inside its runtime-observed `observed_output_schema_versions`, non-empty app-server runtime evidence digests, and `cleanup_status: 'completed'`. This mode is evidence derived from public-safe `CodexDockerRuntimeEvidence` where `app_server_attempted === true` and `selected_execution_mode === 'app_server'`, not a standalone label that can be reported without per-phase app-server proof.

Add focused negative tests:

```ts
expect(() =>
  deriveCodexAppServerEvidence(collectCodexAppServerPhaseEvidence({
    boundary: [{ ...boundaryEvidence, app_server_evidence_digests: [] }],
    spec: { ...specEvidence, app_server_evidence_digests: [] },
    executionPlan: { ...executionPlanEvidence, app_server_evidence_digests: [] },
    execution: { ...executionEvidence, app_server_evidence_digests: [] },
  })),
).toThrow(/codex_runtime_superpowers_app_server_phase_evidence_missing/);

expect(() =>
  deriveCodexAppServerEvidence(collectCodexAppServerPhaseEvidence({
    boundary: [
      boundaryEvidence,
      { ...boundaryEvidence, mode: 'rebase' as const, session_id: 'boundary-session-rebased', runtime_job_digests: [] },
    ],
    spec: specEvidence,
    executionPlan: executionPlanEvidence,
    execution: executionEvidence,
  })),
).toThrow(/codex_runtime_superpowers_app_server_phase_evidence_missing/);

expect(() =>
  deriveCodexAppServerEvidence(collectCodexAppServerPhaseEvidence({
    boundary: [
      boundaryEvidence,
      { ...boundaryEvidence, mode: 'rebase' as const, session_id: 'boundary-session-rebased' },
    ],
    spec: { ...specEvidence, cleanup_status: 'blocked' },
    executionPlan: executionPlanEvidence,
    execution: executionEvidence,
  })),
).toThrow(/codex_runtime_superpowers_app_server_phase_evidence_missing/);
```

Then include the derived evidence in the report:

```ts
const codexAppServerPhases = collectCodexAppServerPhaseEvidence({
  boundary: [initialBoundary, rebasedBoundary],
  spec,
  executionPlan,
  execution,
});
const codexAppServerEvidence = deriveCodexAppServerEvidence(codexAppServerPhases);

package_script_command: 'pnpm dogfood:codex-runtime:superpowers',
codex_app_server_evidence: codexAppServerEvidence,
boundary_ai_turn_count: boundaryAiTurnCount,
boundary_follow_up_path_covered: followUpCovered,
boundary_summary_request_change_path_covered: requestChangeCovered,
cleanup_status: codexAppServerEvidence.phases.every((phase) => phase.cleanup_status === 'completed') ? 'completed' : 'blocked',
report_path: 'docs/superpowers/reports/codex-runtime-real-dogfood-pass.md',
```

Because `collectCodexAppServerPhaseEvidence` returns phase evidence before PASS validation, a cleanup failure can still produce a public-safe `BLOCKED` report containing the blocked phase evidence. `deriveCodexAppServerEvidence` must throw only after attaching these public-safe phases to the blocker details, so cleanup failure never becomes a PASS with `cleanup_status: completed` and never loses the evidence needed for the BLOCKED report.

- [ ] **Step 7: Run the focused test and verify it passes**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: top-level orchestration test passes. Some HTTP-client tests may still fail because their old method names are removed; update them in Task 3.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add scripts/codex-runtime-superpowers-dogfood.ts tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts
git commit -m "feat: remove fixed boundary rounds from codex dogfood"
```

## Task 3: Implement Boundary Session State Loop

**Files:**
- Modify: `tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts`
- Modify: `scripts/codex-runtime-superpowers-dogfood.ts`

- [ ] **Step 1: Add config for bounded loop**

In `tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts`, add a config parser test:

```ts
it('loads bounded Boundary dogfood loop settings from env', () => {
  const config = loadCodexRuntimeSuperpowersDogfoodCliConfig({
    FORGELOOP_CONTROL_PLANE_URL: 'http://control-plane.invalid',
    FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID: 'actor-setup',
    FORGELOOP_CODEX_DOGFOOD_PROJECT_ID: 'project-1',
    FORGELOOP_CODEX_DOGFOOD_SOURCE_OBJECT_ID: 'requirement-1',
    FORGELOOP_CODEX_NO_SHARED_FILESYSTEM: '1',
    FORGELOOP_CODEX_DOGFOOD_BOUNDARY_MAX_AI_TURNS: '6',
  });

  expect(config.boundaryMaxAiTurns).toBe(6);
});
```

- [ ] **Step 2: Run the config test and verify it fails**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because `boundaryMaxAiTurns` does not exist.

- [ ] **Step 3: Add config field and parser**

In `CodexRuntimeSuperpowersDogfoodCliConfig`, add:

```ts
boundaryMaxAiTurns: number;
```

In `loadCodexRuntimeSuperpowersDogfoodCliConfig`, set:

```ts
boundaryMaxAiTurns: nonNegativeIntEnv(env, 'FORGELOOP_CODEX_DOGFOOD_BOUNDARY_MAX_AI_TURNS', 8),
```

Reject `0` after parsing:

```ts
if (config.boundaryMaxAiTurns < 1) {
  throw new Error('FORGELOOP_CODEX_DOGFOOD_BOUNDARY_MAX_AI_TURNS_must_be_positive_integer');
}
```

If using `nonNegativeIntEnv` makes the positive validation awkward, add a `positiveIntEnv` helper and use that.

- [ ] **Step 4: Write the failing state-loop HTTP test**

Replace the old `discovers Boundary AI artifacts and verifies the stale/superseded Boundary check through product API calls` test with a state-driven test that simulates:

1. `POST /boundary-brainstorming` returns `boundary-session-1`.
2. First `GET /boundary-session-1` returns `status: 'ai_turn_running'`, `current_round_runtime_job_id: 'runtime-job-a'`.
3. Runtime job status returns `terminal/succeeded`.
4. Next `GET` returns `status: 'waiting_for_leader'`, one open question `question-1`.
5. Driver answers `question-1` and posts `/continue`.
6. Next `GET` after worker returns a second open follow-up question `question-2`.
7. Driver answers `question-2` and posts `/continue`.
8. Next `GET` returns `status: 'summary_proposed'`, `latest_summary_revision_id: 'summary-1'`.
9. Driver posts `/summary-revisions/summary-1/request-changes`.
10. Next AI turn returns `status: 'summary_proposed'`, `latest_summary_revision_id: 'summary-2'`.
11. Driver posts `/summary-revisions/summary-2/approve`.

Use a fixture shape like:

```ts
const sessionResponses = [
  { id: 'boundary-session-1', status: 'ai_turn_running', current_round_runtime_job_id: 'runtime-job-a', questions: [] },
  { id: 'boundary-session-1', status: 'waiting_for_leader', questions: [{ id: 'question-1', status: 'open', required: true }] },
  { id: 'boundary-session-1', status: 'ai_turn_running', current_round_runtime_job_id: 'runtime-job-b', questions: [{ id: 'question-1', status: 'answered', required: true, answered_by_answer_id: 'answer-1' }] },
  { id: 'boundary-session-1', status: 'waiting_for_leader', questions: [
      { id: 'question-1', status: 'answered', required: true, answered_by_answer_id: 'answer-1' },
      { id: 'question-2', status: 'open', required: true },
    ] },
  { id: 'boundary-session-1', status: 'ai_turn_running', current_round_runtime_job_id: 'runtime-job-c', questions: [
      { id: 'question-1', status: 'answered', required: true, answered_by_answer_id: 'answer-1' },
      { id: 'question-2', status: 'answered', required: true, answered_by_answer_id: 'answer-2' },
    ] },
  { id: 'boundary-session-1', status: 'summary_proposed', latest_summary_revision_id: 'summary-1', questions: [] },
  { id: 'boundary-session-1', status: 'ai_turn_running', current_round_runtime_job_id: 'runtime-job-d', questions: [] },
  { id: 'boundary-session-1', status: 'summary_proposed', latest_summary_revision_id: 'summary-2', questions: [] },
];
```

Assert:

```ts
await client.seedSourceAndDevelopmentPlanItem();
await expect(client.completeBoundaryBrainstorming('initial')).resolves.toMatchObject({
  mode: 'initial',
  session_id: 'boundary-session-1',
  approved_summary_revision_id: 'summary-2',
  ai_turn_count: 4,
  follow_up_path_covered: true,
  summary_request_change_path_covered: true,
  output_schema_versions: ['boundary_round_result.v1'],
  app_server_evidence_digests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
  runtime_job_digests: [digestFromPublicId('runtime-job-a'), digestFromPublicId('runtime-job-b'), digestFromPublicId('runtime-job-c'), digestFromPublicId('runtime-job-d')],
  cleanup_status: 'completed',
});
```

If `digestFromPublicId` is private, assert on `sha256:` format and count instead.

Also assert the route calls include:

```ts
POST /boundary-brainstorming-sessions/boundary-session-1/answers
POST /boundary-brainstorming-sessions/boundary-session-1/continue
POST /boundary-brainstorming-sessions/boundary-session-1/summary-revisions/summary-1/request-changes
POST /boundary-brainstorming-sessions/boundary-session-1/summary-revisions/summary-2/approve
```

- [ ] **Step 5: Run the state-loop test and verify it fails**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because `completeBoundaryBrainstorming` is not implemented.

- [ ] **Step 6: Implement state helpers**

In `scripts/codex-runtime-superpowers-dogfood.ts`, extend `BoundarySessionApiResponse`:

```ts
type BoundarySessionApiResponse = {
  id: string;
  status?: 'draft' | 'ai_turn_running' | 'waiting_for_leader' | 'summary_proposed' | 'approved' | 'changes_requested' | 'stale' | 'cancelled';
  questions?: Array<{ id: string; status?: string; required?: boolean; answered_by_answer_id?: string }>;
  latest_summary_revision_id?: string;
  approved_summary_revision_id?: string;
  current_round_runtime_job_id?: string;
};
```

Add helpers near the existing Boundary helpers:

```ts
const boundaryRuntimeJobDigests: Sha256Digest[] = [];

const runtimeJobDigestFromId = (runtimeJobId: string): Sha256Digest => digestFromPublicId(runtimeJobId);

const openBoundaryQuestions = (session: BoundarySessionApiResponse | undefined) =>
  session?.questions?.filter(
    (question) => question.answered_by_answer_id === undefined && (question.required === true || question.status === 'open'),
  ) ?? [];

const answerOpenBoundaryQuestions = async (session: BoundarySessionApiResponse): Promise<number> => {
  const questions = openBoundaryQuestions(session);
  for (const question of questions) {
    await answerBoundaryQuestionById(
      session.id,
      question.id,
      'Keep the dogfood boundary docs-only, prove Codex-led follow-up handling, preserve centralized config/auth distribution, and reject worker-local Codex state.',
    );
  }
  return questions.length;
};
```

- [ ] **Step 7: Implement `completeBoundaryBrainstorming`**

Inside `createCodexRuntimeSuperpowersDogfoodHttpClient`, implement:

```ts
async completeBoundaryBrainstorming(mode) {
  const planId = requireState(developmentPlanId, 'codex_runtime_superpowers_dogfood_plan_missing');
  const itemId = requireState(developmentPlanItemId, 'codex_runtime_superpowers_dogfood_item_missing');
  const requestChangeRequired = mode === 'initial';
  let aiTurnCount = 0;
  let answeredAtLeastOnce = false;
  let followUpPathCovered = false;
  let summaryRequestChangePathCovered = false;
  const runtimeJobDigests: Sha256Digest[] = [];
  const outputSchemaVersions: string[] = [];
  const appServerEvidenceDigests: Sha256Digest[] = [];
  const cleanupStatuses: Array<'completed' | 'blocked'> = [];

  const startPath =
    mode === 'initial'
      ? `/development-plans/${planId}/items/${itemId}/boundary-brainstorming`
      : `/development-plans/${planId}/items/${itemId}/boundary-brainstorming/restart`;
  const started = await requestJson<{ id: string }>(config, startPath, {
    method: 'POST',
    body: {
      actor_id: config.leaderActorId,
      leader_actor_id: config.leaderActorId,
      initial_leader_context_markdown:
        mode === 'initial'
          ? 'Start the strict Codex runtime real dogfood boundary. Ask follow-up questions when needed before proposing a summary.'
          : 'Rebase the strict Codex runtime dogfood boundary after the Development Plan Item revision changed.',
    },
  }, fetchDeps);
  boundarySessionId = started.id;
  cachedBoundarySession = undefined;

  for (let iteration = 0; iteration < config.boundaryMaxAiTurns * 3; iteration += 1) {
    const session = await fetchBoundarySession();
    if (session.status === 'ai_turn_running') {
      const runtimeJobId = session.current_round_runtime_job_id;
      await invokeRemoteWorkerUntil({
        targetKind: 'generation',
        blockerCode: 'codex_runtime_superpowers_dogfood_boundary_turn_unsettled',
        observe: async () => {
          const currentSession = await fetchBoundarySession();
          return currentSession.status === 'ai_turn_running' ? undefined : currentSession;
        },
        runtimeJobId: () => runtimeJobId,
      });
      aiTurnCount += 1;
      if (runtimeJobId !== undefined) {
        runtimeJobDigests.push(runtimeJobDigestFromId(runtimeJobId));
        outputSchemaVersions.push(...(await runtimeJobOutputSchemaVersions(runtimeJobId)));
        appServerEvidenceDigests.push(...(await runtimeJobAppServerEvidenceDigests(runtimeJobId)));
        cleanupStatuses.push(await runtimeJobCleanupStatus(runtimeJobId));
      }
      if (aiTurnCount > config.boundaryMaxAiTurns) {
        throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_boundary_max_turns_exceeded', {
          status: 'BLOCKED',
          blocker_code: 'codex_runtime_superpowers_boundary_max_turns_exceeded',
        });
      }
      continue;
    }

    if (session.status === 'waiting_for_leader' || session.status === 'changes_requested') {
      const answeredCount = await answerOpenBoundaryQuestions(session);
      if (answeredAtLeastOnce && answeredCount > 0) {
        followUpPathCovered = true;
      }
      answeredAtLeastOnce = answeredAtLeastOnce || answeredCount > 0;
      await requestJson(config, `/boundary-brainstorming-sessions/${session.id}/continue`, {
        method: 'POST',
        body: {
          actor_id: config.leaderActorId,
          leader_input_markdown:
            answeredCount > 0
              ? 'Continue after Leader answers. Ask another follow-up if the boundary is still ambiguous; otherwise propose a Boundary Summary.'
              : 'Continue with the existing Leader context. Ask questions if needed; otherwise propose a Boundary Summary.',
        },
      }, fetchDeps);
      cachedBoundarySession = undefined;
      continue;
    }

    if (session.status === 'summary_proposed') {
      const revisionId = requireState(
        boundarySummaryRevisionIdFromSession(session),
        'codex_runtime_superpowers_dogfood_boundary_summary_revision_id_missing',
      );
      if (requestChangeRequired && !summaryRequestChangePathCovered) {
        await requestJson(config, `/boundary-brainstorming-sessions/${session.id}/summary-revisions/${revisionId}/request-changes`, {
          method: 'POST',
          body: {
            actor_id: config.leaderActorId,
            feedback_markdown:
              'Revise the Boundary Summary to explicitly include Codex-led follow-up evidence, centralized config/auth distribution, no-shared-filesystem execution, and docs-only mutation constraints.',
          },
        }, fetchDeps);
        summaryRequestChangePathCovered = true;
        cachedBoundarySession = undefined;
        continue;
      }
      const approved = await requestJson<{ id?: string; revision_id?: string; boundary_summary_revision_id?: string }>(
        config,
        `/boundary-brainstorming-sessions/${session.id}/summary-revisions/${revisionId}/approve`,
        {
          method: 'POST',
          body: {
            actor_id: config.leaderActorId,
            final_decision: 'Approve the current strict Codex runtime real dogfood boundary.',
          },
        },
        fetchDeps,
      );
      boundarySummaryRevisionId = approved.boundary_summary_revision_id ?? approved.id ?? approved.revision_id ?? revisionId;
      return {
        mode,
        session_id: session.id,
        approved_summary_revision_id: boundarySummaryRevisionId,
        ai_turn_count: aiTurnCount,
        follow_up_path_covered: followUpPathCovered,
        summary_request_change_path_covered: summaryRequestChangePathCovered,
        output_schema_versions: Array.from(new Set(outputSchemaVersions)),
        app_server_evidence_digests: Array.from(new Set(appServerEvidenceDigests)),
        runtime_job_digests: runtimeJobDigests,
        cleanup_status: cleanupStatuses.includes('blocked') ? 'blocked' : 'completed',
      };
    }

    throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_boundary_unexpected_state', {
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_boundary_unexpected_state',
    });
  }

  throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_boundary_loop_exhausted', {
    status: 'BLOCKED',
    blocker_code: 'codex_runtime_superpowers_boundary_loop_exhausted',
  });
}
```

Adjust names/types as needed, but preserve behavior.

- [ ] **Step 8: Remove obsolete fixed-round methods**

Delete or stop exporting:

```ts
runBoundaryBrainstormingRound
answerBoundaryQuestion
proposeBoundarySummary
rebaseBoundaryBrainstorming
approveBoundarySummary
```

Update old tests to use `completeBoundaryBrainstorming` or delete tests that only prove fixed-round behavior.

- [ ] **Step 9: Run the focused test and verify it passes**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 10: Commit Task 3**

Run:

```bash
git add scripts/codex-runtime-superpowers-dogfood.ts tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts
git commit -m "feat: drive boundary dogfood from session state"
```

## Task 4: Preserve Runtime Job, Schema, And App-Server Evidence Through Generation And Execution

**Files:**
- Modify: `tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts`
- Modify: `scripts/codex-runtime-superpowers-dogfood.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts` only if the public internal runtime-job projection does not expose enough public-safe fields for the script to derive schema/app-server evidence
- Modify: `packages/domain/src/codex-runtime.ts` only if run-execution terminal results must carry public-safe `runtime_evidence`
- Modify: `packages/codex-worker-runtime/src/remote-worker-client.ts` only if run-execution terminal results must carry public-safe `runtime_evidence`
- Test: `tests/api/codex-runtime-control-plane.test.ts` only if the projection changes
- Test: `tests/domain/codex-runtime.test.ts` only if domain runtime result validation changes
- Test: `tests/codex-worker-runtime/remote-worker-client.test.ts` only if worker terminal result payload changes

- [ ] **Step 1: Write failing tests for runtime job digest propagation**

Update the existing Spec generation, Execution Plan generation, and Execution tests so returned values include `runtime_job_digests` and `output_schema_versions`.

Spec assertion:

```ts
await expect(client.generateAndApproveSpec()).resolves.toMatchObject({
  spec_revision_id: 'spec-revision-1',
  output_schema_versions: ['spec_revision.v1'],
  app_server_evidence_digests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
  runtime_job_digests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
});
```

Execution Plan assertion:

```ts
await expect(client.generateAndApproveExecutionPlan()).resolves.toMatchObject({
  execution_plan_revision_id: 'execution-plan-revision-1',
  output_schema_versions: ['execution_plan_revision.v1'],
  app_server_evidence_digests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
  runtime_job_digests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
});
```

Execution assertion:

```ts
await expect(client.startExecution()).resolves.toMatchObject({
  execution_id: 'execution-1',
  output_schema_versions: ['codex_run_execution_result.v1'],
  app_server_evidence_digests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
  runtime_job_digests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because these return types do not include `runtime_job_digests`, `output_schema_versions`, and `app_server_evidence_digests`.

- [ ] **Step 3: Extend method return types**

In `CodexRuntimeSuperpowersDogfoodClient`, change the return types to the Task 1 evidence interfaces:

```ts
generateAndApproveSpec: () => Promise<CodexRuntimeSpecDogfoodEvidence>;
generateAndApproveExecutionPlan: () => Promise<CodexRuntimeExecutionPlanDogfoodEvidence>;
startExecution: () => Promise<CodexRuntimeExecutionDogfoodEvidence>;
```

- [ ] **Step 4: Add projection test for runtime job schema and app-server evidence**

Before changing the dogfood client, add or update a control-plane test in `tests/api/codex-runtime-control-plane.test.ts` for:

```ts
GET /internal/codex-runtime/runtime-jobs/:runtimeJobId
```

The response must expose only public-safe evidence needed by the dogfood script:

```ts
expect(response.body.runtime_job).toMatchObject({
  id: 'runtime-job-1',
  input: {
    schema_version: 'codex_generation_workload.v1',
    output_schema_version: 'spec_revision.v1',
  },
  terminal_result_json: {
    output_schema_version: 'spec_revision.v1',
    runtime_evidence: {
      app_server_attempted: true,
      selected_execution_mode: 'app_server',
    },
  },
});
expect(response.body.artifacts).toContainEqual(
  expect.objectContaining({
    kind: 'generated_payload',
    metadata_json: expect.objectContaining({
      output_schema_version: 'spec_revision.v1',
      generated_payload: expect.objectContaining({ schema_version: 'spec_revision.v1' }),
    }),
  }),
);
```

Add the equivalent run-execution expectation for `input.output_schema_version: 'codex_run_execution_result.v1'`. That expectation must also prove the run-execution runtime job exposes validated public-safe app-server evidence with `app_server_attempted: true` and `selected_execution_mode: 'app_server'`. If the current projection only exposes `runtime_evidence_digest`, this test must fail before the worker/service projection is changed.

- [ ] **Step 5: Expose public-safe runtime job projection fields if missing**

If Step 4 fails because `publicRuntimeJob()` only exposes `input.schema_version`, extend `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts` to include safe output schema and terminal result fields:

```ts
input: {
  input_digest: job.input_digest,
  ...(job.input_json.schema_version === undefined ? {} : { schema_version: job.input_json.schema_version }),
  ...(job.input_json.output_schema_version === undefined ? {} : { output_schema_version: job.input_json.output_schema_version }),
},
...(job.terminal_result_json === undefined
  ? {}
  : {
      terminal_result_json: {
        ...(typeof job.terminal_result_json.output_schema_version === 'string'
          ? { output_schema_version: job.terminal_result_json.output_schema_version }
          : {}),
        ...(isPlainObject(job.terminal_result_json.runtime_evidence)
          ? { runtime_evidence: job.terminal_result_json.runtime_evidence }
          : {}),
      },
    }),
```

If run-execution terminal results do not currently include `runtime_evidence`, make one narrow implementation change before the dogfood script consumes app-server evidence:

```ts
// packages/codex-worker-runtime/src/remote-worker-client.ts
const terminalResult: CodexRunExecutionRuntimeJobResult = {
  task_kind: 'run_execution',
  // existing fields...
  runtime_evidence: appServerSession.publicEvidence,
};
```

and update `packages/domain/src/codex-runtime.ts` so `CodexRunExecutionRuntimeJobResult` accepts and validates `runtime_evidence` with `validateCodexDockerRuntimeEvidence`, matching generation terminal results. Add focused domain/worker tests proving the added field remains public-safe and rejects non-app-server fallback evidence.

Do not expose raw prompts, endpoint URLs, container ids, host paths, raw config, or raw auth. `runtime_evidence` is already validated public-safe by domain validators; if the service cannot rely on that invariant, import and apply `validateCodexDockerRuntimeEvidence` before projecting it.

- [ ] **Step 6: Add helpers to extract runtime job output schema and app-server evidence**

Extend `RuntimeJobProjection` and `RuntimeJobArtifactProjection` enough to read public-safe schema metadata from the internal runtime job endpoint:

```ts
type RuntimeJobProjection = {
  id: string;
  status?: string;
  terminal_status?: string;
  terminal_reason_code?: string;
  input?: {
    schema_version?: unknown;
    output_schema_version?: unknown;
  };
  terminal_result_json?: {
    output_schema_version?: unknown;
    runtime_evidence?: unknown;
  };
};

type RuntimeJobArtifactProjection = {
  kind?: string;
  metadata_json?: {
    failure_subcode?: string;
    reason_code?: string;
    public_summary?: string;
    output_schema_version?: unknown;
    generated_payload?: { schema_version?: unknown };
    runtime_evidence?: unknown;
  };
};
```

Add a public-safe extractor:

```ts
const runtimeJobOutputSchemaVersions = async (runtimeJobId: string): Promise<string[]> => {
  const diagnostic = await fetchRuntimeJobWithArtifacts(runtimeJobId);
  const candidates = [
    diagnostic.runtime_job.input?.output_schema_version,
    diagnostic.runtime_job.terminal_result_json?.output_schema_version,
    ...diagnostic.artifacts.flatMap((artifact) => [
      artifact.metadata_json?.output_schema_version,
      artifact.metadata_json?.generated_payload?.schema_version,
    ]),
  ];
  const versions = candidates.filter((value): value is string => typeof value === 'string' && publicIdPattern.test(value));
  return Array.from(new Set(versions));
};
```

Add an app-server evidence extractor that requires real app-server runtime evidence:

```ts
const runtimeJobAppServerEvidenceDigests = async (runtimeJobId: string): Promise<Sha256Digest[]> => {
  const diagnostic = await fetchRuntimeJobWithArtifacts(runtimeJobId);
  const candidates = [
    diagnostic.runtime_job.terminal_result_json?.runtime_evidence,
    ...diagnostic.artifacts.flatMap((artifact) => [
      artifact.metadata_json?.runtime_evidence,
      artifact.metadata_json?.generated_payload?.runtime_evidence,
    ]),
  ];
  const valid = candidates.filter(
    (candidate): candidate is Record<string, unknown> =>
      isPlainObject(candidate) &&
      candidate.app_server_attempted === true &&
      candidate.selected_execution_mode === 'app_server',
  );
  return Array.from(new Set(valid.map((candidate) => codexCanonicalDigest(candidate) as Sha256Digest)));
};
```

Add cleanup status extraction. Cleanup failure evidence is already uploaded as public-safe `cleanup_failure_evidence` by the remote worker; the dogfood script must not hide it behind a static `completed` value:

```ts
const runtimeJobCleanupStatus = async (runtimeJobId: string): Promise<'completed' | 'blocked'> => {
  const diagnostic = await fetchRuntimeJobWithArtifacts(runtimeJobId);
  const cleanupFailures = diagnostic.artifacts.filter((artifact) => artifact.kind === 'cleanup_failure_evidence');
  for (const artifact of cleanupFailures) {
    assertPublicSafeId(String(artifact.metadata_json?.reason_code ?? 'codex_runtime_cleanup_failed'), 'cleanup_failure_reason_code');
    const publicSummary = artifact.metadata_json?.public_summary;
    if (
      typeof publicSummary === 'string' &&
      (/\/Users\/|\/tmp\/|~\/\.codex|127\.0\.0\.1|localhost|container-[A-Za-z0-9_-]+|auth\.json|config\.toml/.test(publicSummary) ||
        publicSummary.includes('://'))
    ) {
      throw new Error('codex_runtime_superpowers_dogfood_report_unsafe:cleanup_failure_public_summary');
    }
  }
  return cleanupFailures.length === 0 ? 'completed' : 'blocked';
};
```

Add a negative test where one runtime job has:

```ts
artifacts: [
  {
    kind: 'cleanup_failure_evidence',
    metadata_json: {
      reason_code: 'codex_runtime_cleanup_failed',
      public_summary: 'Remote Codex app-server cleanup failed after generation.',
    },
  },
]
```

and assert the phase evidence returns `cleanup_status: 'blocked'`, causing `deriveCodexAppServerEvidence` to throw `codex_runtime_superpowers_app_server_phase_evidence_missing`. Also assert unsafe cleanup details such as `/tmp/private` or `container-123` are rejected before rendering a report.

Also assert the thrown blocker keeps the public-safe phase evidence:

```ts
try {
  deriveCodexAppServerEvidence(
    collectCodexAppServerPhaseEvidence({
      boundary: [boundaryEvidence, { ...boundaryEvidence, mode: 'rebase' as const, session_id: 'boundary-session-rebased' }],
      spec: { ...specEvidence, cleanup_status: 'blocked' },
      executionPlan: executionPlanEvidence,
      execution: executionEvidence,
    }),
  );
  expect.unreachable('expected blocked phase evidence');
} catch (error) {
  expect(error).toMatchObject({
    blockerCode: 'codex_runtime_superpowers_app_server_phase_evidence_missing',
    report: {
      cleanup_status: 'blocked',
      codex_app_server_evidence: {
        phases: [
          expect.objectContaining({
            phase: 'spec',
            expected_output_schema_version: 'spec_revision.v1',
            observed_output_schema_versions: ['spec_revision.v1'],
            cleanup_status: 'blocked',
          }),
        ],
      },
    },
  });
}
```

If the runtime job endpoint does not expose a schema version or app-server evidence for a phase, return an empty array and let final app-server evidence validation block if the full pass lacks schema or app-server proof. Do not default these helpers to guessed schema versions or guessed app-server mode.

- [ ] **Step 7: Populate Spec and Execution Plan runtime evidence**

In `generateAndApproveSpec`, after requiring `runtimeJobId`, return:

```ts
return {
  spec_revision_id: requireState(specRevisionId, 'codex_runtime_superpowers_dogfood_spec_revision_missing'),
  output_schema_versions: await runtimeJobOutputSchemaVersions(runtimeJobId),
  app_server_evidence_digests: await runtimeJobAppServerEvidenceDigests(runtimeJobId),
  runtime_job_digests: [runtimeJobDigestFromId(runtimeJobId)],
  cleanup_status: await runtimeJobCleanupStatus(runtimeJobId),
};
```

In `generateAndApproveExecutionPlan`, return:

```ts
return {
  execution_plan_revision_id: requireState(
    executionPlanRevisionId,
    'codex_runtime_superpowers_dogfood_execution_plan_revision_missing',
  ),
  output_schema_versions: await runtimeJobOutputSchemaVersions(runtimeJobId),
  app_server_evidence_digests: await runtimeJobAppServerEvidenceDigests(runtimeJobId),
  runtime_job_digests: [runtimeJobDigestFromId(runtimeJobId)],
  cleanup_status: await runtimeJobCleanupStatus(runtimeJobId),
};
```

- [ ] **Step 8: Populate run-execution runtime evidence**

In `startExecution`, after deriving `runSessionId` and `executionPackageId`, compute:

```ts
const runtimeJobId = await runtimeJobIdForRunExecution(executionPackageId, runSessionId);
```

Return:

```ts
output_schema_versions:
  runtimeJobId === undefined ? [] : await runtimeJobOutputSchemaVersions(runtimeJobId),
app_server_evidence_digests:
  runtimeJobId === undefined ? [] : await runtimeJobAppServerEvidenceDigests(runtimeJobId),
runtime_job_digests: runtimeJobId === undefined ? [] : [runtimeJobDigestFromId(runtimeJobId)],
cleanup_status: runtimeJobId === undefined ? 'blocked' : await runtimeJobCleanupStatus(runtimeJobId),
```

If the runtime job id cannot be derived, keep returning empty arrays but add a public-safe blocker only if the final report would otherwise have no runtime job digests, no output schema evidence, or no app-server evidence.

- [ ] **Step 9: Require non-empty final app-server runtime evidence**

In `deriveCodexAppServerEvidence`, require non-empty runtime job digests, non-empty output schema evidence, and non-empty app-server evidence:

```ts
if (runtimeJobDigests.length === 0 || outputSchemaVersions.length === 0 || appServerEvidenceDigests.length === 0) {
  throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_app_server_evidence_missing', {
    status: 'BLOCKED',
    blocker_code: 'codex_runtime_superpowers_app_server_evidence_missing',
  });
}
```

- [ ] **Step 10: Run focused tests and verify pass**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts tests/api/codex-runtime-control-plane.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

If Step 5 changed `packages/domain/src/codex-runtime.ts` or `packages/codex-worker-runtime/src/remote-worker-client.ts`, also include their focused tests in the same verification run:

```bash
pnpm vitest run tests/domain/codex-runtime.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 11: Commit Task 4**

Run:

```bash
git add scripts/codex-runtime-superpowers-dogfood.ts tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts tests/api/codex-runtime-control-plane.test.ts packages/domain/src/codex-runtime.ts tests/domain/codex-runtime.test.ts packages/codex-worker-runtime/src/remote-worker-client.ts tests/codex-worker-runtime/remote-worker-client.test.ts
git commit -m "feat: record codex dogfood runtime schema evidence"
```

If `packages/domain/src/codex-runtime.ts`, `tests/domain/codex-runtime.test.ts`, `packages/codex-worker-runtime/src/remote-worker-client.ts`, or `tests/codex-worker-runtime/remote-worker-client.test.ts` were not touched because the existing projection already carried validated run-execution runtime evidence, do not stage them. Before committing, run `git status --short` and ensure every touched Task 4 file is either intentionally staged or intentionally absent from the diff.

## Task 5: Update Runbook And Guard Tests

**Files:**
- Modify: `docs/runbooks/codex-remote-worker-runtime.md`
- Modify: `scripts/check-codex-runtime-superpowers-no-baggage.ts` only if required
- Modify: `tests/smoke/codex-runtime-no-baggage-gate.test.ts` only if required
- Modify: `tests/smoke/runbook-script-consistency.test.ts` only if required

- [ ] **Step 1: Update the runbook language**

In `docs/runbooks/codex-remote-worker-runtime.md`, in `Superpowers Product Loop Dogfood`, update the prose after the command block to state:

```md
This command is the canonical real dogfood pass. It drives Boundary Brainstorming from persisted session state, not fixed round numbers. The expected report path is `docs/superpowers/reports/codex-runtime-real-dogfood-pass.md`.

The report must include the Boundary AI turn count, follow-up-path coverage, summary request-change coverage, stale-boundary negative result, runtime profile/credential digests, app-server runtime job digests, workspace bundle digest, mounted task workspace digest, changed files, and cleanup status.
```

Do not add `pnpm dogfood:codex-runtime:real` unless `package.json` is also changed and `scripts/check-runbook-scripts.ts` is updated. Preferred outcome: keep `pnpm dogfood:codex-runtime:superpowers`.

- [ ] **Step 2: Run runbook consistency check**

Run:

```bash
pnpm check:runbook-scripts
```

Expected: PASS.

- [ ] **Step 3: Run no-baggage check**

Run:

```bash
pnpm check:codex-runtime-superpowers-no-baggage
```

Expected: PASS. If it fails on the new report path or allowed negative wording, update `scripts/check-codex-runtime-superpowers-no-baggage.ts` with a narrow allowlist entry and add/adjust a smoke test in `tests/smoke/codex-runtime-no-baggage-gate.test.ts`.

- [ ] **Step 4: Run focused smoke tests**

Run:

```bash
pnpm vitest run tests/smoke/runbook-script-consistency.test.ts tests/smoke/codex-runtime-no-baggage-gate.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add docs/runbooks/codex-remote-worker-runtime.md scripts/check-codex-runtime-superpowers-no-baggage.ts tests/smoke/codex-runtime-no-baggage-gate.test.ts tests/smoke/runbook-script-consistency.test.ts
git commit -m "docs: document real codex runtime dogfood evidence"
```

If only the runbook changed, stage only the runbook.

## Task 6: Isolated Dogfood Worktree Guard

**Files:**
- Modify: `scripts/codex-runtime-superpowers-dogfood.ts`
- Modify: `tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts`

- [ ] **Step 1: Add failing isolated worktree config tests**

Add tests for a new helper `resolveDogfoodIsolatedWorktreeConfig(env)`:

```ts
it('requires an isolated dogfood worktree based on main', () => {
  const fakeGit = makeFakeDogfoodGit({
    worktreePath: process.cwd(),
    currentBranch: 'feature/codex-runtime-real-dogfood-pass',
    headSha: featureCommitSha,
    mainSha: mainCommitSha,
    statusPorcelain: '',
    registeredWorktreePaths: [process.cwd()],
  });

  expect(() =>
    resolveDogfoodIsolatedWorktreeConfig({
      FORGELOOP_CODEX_DOGFOOD_REPO_PATH: process.cwd(),
      FORGELOOP_CODEX_DOGFOOD_REPO_BASE_BRANCH: 'main',
      FORGELOOP_CODEX_DOGFOOD_ISOLATED_WORKTREE: '0',
    }, fakeGit),
  ).toThrow(/codex_runtime_superpowers_dogfood_isolated_worktree_missing/);
});

it('rejects an env-flagged worktree when git says it is on a feature branch', () => {
  const fakeGit = makeFakeDogfoodGit({
    worktreePath: isolatedWorktreePath,
    currentBranch: 'feature/codex-runtime-real-dogfood-pass',
    headSha: featureCommitSha,
    mainSha: mainCommitSha,
    statusPorcelain: '',
    registeredWorktreePaths: [isolatedWorktreePath],
  });

  expect(() =>
    resolveDogfoodIsolatedWorktreeConfig({
      FORGELOOP_CODEX_DOGFOOD_REPO_PATH: isolatedWorktreePath,
      FORGELOOP_CODEX_DOGFOOD_REPO_BASE_BRANCH: 'main',
      FORGELOOP_CODEX_DOGFOOD_REPO_BASE_COMMIT_SHA: mainCommitSha,
      FORGELOOP_CODEX_DOGFOOD_ISOLATED_WORKTREE: '1',
    }, fakeGit),
  ).toThrow(/codex_runtime_superpowers_dogfood_not_based_on_main/);
});

it('rejects an env-flagged main worktree when it is dirty', () => {
  const fakeGit = makeFakeDogfoodGit({
    worktreePath: isolatedWorktreePath,
    currentBranch: '',
    headSha: mainCommitSha,
    mainSha: mainCommitSha,
    statusPorcelain: ' M docs/superpowers/reports/codex-runtime-real-dogfood-pass.md\n',
    registeredWorktreePaths: [isolatedWorktreePath],
  });

  expect(() =>
    resolveDogfoodIsolatedWorktreeConfig({
      FORGELOOP_CODEX_DOGFOOD_REPO_PATH: isolatedWorktreePath,
      FORGELOOP_CODEX_DOGFOOD_REPO_BASE_BRANCH: 'main',
      FORGELOOP_CODEX_DOGFOOD_REPO_BASE_COMMIT_SHA: mainCommitSha,
      FORGELOOP_CODEX_DOGFOOD_ISOLATED_WORKTREE: '1',
    }, fakeGit),
  ).toThrow(/codex_runtime_superpowers_dogfood_worktree_dirty/);
});

it('accepts an explicit clean detached isolated worktree at main head', () => {
  const fakeGit = makeFakeDogfoodGit({
    worktreePath: isolatedWorktreePath,
    currentBranch: '',
    headSha: mainCommitSha,
    mainSha: mainCommitSha,
    statusPorcelain: '',
    registeredWorktreePaths: [isolatedWorktreePath],
  });

  const config = resolveDogfoodIsolatedWorktreeConfig({
    FORGELOOP_CODEX_DOGFOOD_REPO_PATH: isolatedWorktreePath,
    FORGELOOP_CODEX_DOGFOOD_REPO_BASE_BRANCH: 'main',
    FORGELOOP_CODEX_DOGFOOD_REPO_BASE_COMMIT_SHA: mainCommitSha,
    FORGELOOP_CODEX_DOGFOOD_ISOLATED_WORKTREE: '1',
  }, fakeGit);

  expect(config.repoBaseBranch).toBe('main');
  expect(config.isolatedWorktree).toBe(true);
  expect(config.repoBaseCommitSha).toMatch(/^[0-9a-f]{40}$/);
});
```

The helper must not rely on the feature branch worktree as the dogfood target. The tests must mock or exercise real git commands, not only env parsing, so a wrong-but-env-flagged path cannot pass validation.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because isolated worktree config is not enforced.

- [ ] **Step 3: Implement isolated worktree validation**

Extend `CodexRuntimeSuperpowersDogfoodCliConfig`:

```ts
repoBaseBranch: 'main';
isolatedWorktree: true;
dogfood_worktree_base: {
  mode: 'isolated_main_worktree';
  base_commit_digest: Sha256Digest;
};
```

Implement `resolveDogfoodIsolatedWorktreeConfig`:

```ts
interface DogfoodGit {
  statusPorcelain(repoPath: string): string;
  currentBranch(repoPath: string): string;
  headSha(repoPath: string): string;
  mainSha(repoPath: string): string;
  registeredWorktreePaths(repoPath: string): string[];
}

const resolveDogfoodIsolatedWorktreeConfig = (env: EnvLike = process.env, git: DogfoodGit = shellDogfoodGit) => {
  const repoLocalPath = optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_REPO_PATH') ?? process.cwd();
  const repoBaseBranch = optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_REPO_BASE_BRANCH') ?? 'main';
  const isolatedWorktree = optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_ISOLATED_WORKTREE') === '1';
  const headSha = git.headSha(repoLocalPath);
  const mainSha = git.mainSha(repoLocalPath);
  const currentBranch = git.currentBranch(repoLocalPath);
  const registeredWorktreePaths = git.registeredWorktreePaths(repoLocalPath).map((path) => resolve(path));
  const repoBaseCommitSha = optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_REPO_BASE_COMMIT_SHA') ?? headSha;

  if (repoBaseBranch !== 'main' || !isolatedWorktree) {
    throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_dogfood_isolated_worktree_missing', {
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_dogfood_isolated_worktree_missing',
    });
  }

  if (!registeredWorktreePaths.includes(resolve(repoLocalPath))) {
    throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_dogfood_isolated_worktree_missing', {
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_dogfood_isolated_worktree_missing',
    });
  }

  if (git.statusPorcelain(repoLocalPath) !== '') {
    throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_dogfood_worktree_dirty', {
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_dogfood_worktree_dirty',
    });
  }

  if (currentBranch !== '' || headSha !== mainSha || repoBaseCommitSha !== mainSha) {
    throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_dogfood_not_based_on_main', {
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_dogfood_not_based_on_main',
    });
  }

  return {
    repoLocalPath,
    repoBaseBranch: 'main' as const,
    repoBaseCommitSha: mainSha,
    isolatedWorktree: true as const,
    dogfood_worktree_base: {
      mode: 'isolated_main_worktree' as const,
      base_commit_digest: canonicalPublicDigest({ repoBaseBranch, repoBaseCommitSha: mainSha }),
    },
  };
};
```

`shellDogfoodGit` should implement those methods with `git -C "$repoLocalPath" status --porcelain=v1`, `git -C "$repoLocalPath" branch --show-current`, `git -C "$repoLocalPath" rev-parse HEAD`, `git -C "$repoLocalPath" rev-parse main`, and `git worktree list --porcelain`. Do not render these raw paths in reports.

If implementation chooses to auto-create the worktree, it may do so with `git worktree add --detach "$path" main` under a disposable path, but it still must run the same validation above after creation. If auto-create is not implemented, the command must fail with the public-safe blocker above unless the explicit env points at a verified clean isolated worktree whose `HEAD` equals local `main`.

- [ ] **Step 4: Add worktree base evidence to PASS and BLOCKED reports**

Extend the PASS report:

```ts
dogfood_worktree_base: {
  mode: 'isolated_main_worktree';
  base_commit_digest: Sha256Digest;
};
```

Extend `CodexRuntimeSuperpowersDogfoodBlockerReport`:

```ts
export interface CodexRuntimeBlockedAppServerPhaseEvidence {
  phase: 'boundary_initial' | 'boundary_rebase' | 'spec' | 'execution_plan' | 'execution';
  expected_output_schema_version: string;
  observed_output_schema_versions: string[];
  runtime_job_digests: Sha256Digest[];
  app_server_evidence_digests: Sha256Digest[];
  cleanup_status: 'completed' | 'blocked';
}

export interface CodexRuntimeSuperpowersDogfoodBlockerReport {
  cleanup_status?: 'completed' | 'blocked';
  codex_app_server_evidence?: {
    mode?: 'dockerized_app_server';
    output_schema_versions?: string[];
    runtime_job_digests?: Sha256Digest[];
    app_server_evidence_digests?: Sha256Digest[];
    phases?: CodexRuntimeBlockedAppServerPhaseEvidence[];
  };
  dogfood_worktree_base?: {
    mode: 'isolated_main_worktree';
    base_commit_digest: Sha256Digest;
  };
}
```

Render these fields in both PASS and BLOCKED reports with `assertPublicSafeId` and `assertSha256Digest`. Do not render absolute worktree paths or branch-local filesystem paths.

- [ ] **Step 5: Thread worktree evidence into seeding and execution**

When seeding source/repo data, use the verified `repoLocalPath` and `repoBaseCommitSha` from `resolveDogfoodIsolatedWorktreeConfig`. The dogfood command must reject a repo path that is dirty before execution starts:

```bash
git -C "$FORGELOOP_CODEX_DOGFOOD_REPO_PATH" diff --quiet
git -C "$FORGELOOP_CODEX_DOGFOOD_REPO_PATH" diff --cached --quiet
```

If either command fails, write a public-safe BLOCKED report with `blocker_code: codex_runtime_superpowers_dogfood_worktree_dirty`.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

Commit:

```bash
git add scripts/codex-runtime-superpowers-dogfood.ts tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts
git commit -m "feat: require isolated main dogfood worktree"
```

## Task 7: Real Dogfood Command And BLOCKED Report Behavior

**Files:**
- Modify: `scripts/codex-runtime-superpowers-dogfood.ts`
- Modify: `tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts`
- Create or update during real run: `docs/superpowers/reports/codex-runtime-real-dogfood-pass.md`

- [ ] **Step 1: Add test for max-turn BLOCKED report**

Add a test where session responses never leave `ai_turn_running` or alternate without producing a summary until `FORGELOOP_CODEX_DOGFOOD_BOUNDARY_MAX_AI_TURNS=1` is exceeded.

Assert:

```ts
await expect(client.completeBoundaryBrainstorming('initial')).rejects.toMatchObject({
  blockerCode: 'codex_runtime_superpowers_boundary_max_turns_exceeded',
});
```

Render the blocker report and verify it has no raw endpoint/path values.

- [ ] **Step 2: Run focused test and verify failure**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL if max-turn blocker is not implemented correctly.

- [ ] **Step 3: Implement or fix max-turn behavior**

Ensure every completed AI turn increments `ai_turn_count`, and exceeding `boundaryMaxAiTurns` throws:

```ts
new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_boundary_max_turns_exceeded', {
  status: 'BLOCKED',
  blocker_code: 'codex_runtime_superpowers_boundary_max_turns_exceeded',
});
```

- [ ] **Step 4: Make main write a BLOCKED report file**

Currently `main()` prints blocker markdown. Update the `catch` path so public-safe blocker markdown is also written to `docs/superpowers/reports/codex-runtime-real-dogfood-pass.md`. When the blocker details contain collected public-safe `codex_app_server_evidence.phases`, include those phases and `cleanup_status: 'blocked'` in the BLOCKED report so it satisfies the report evidence contract without claiming PASS.

Use a helper:

```ts
const writeCodexRuntimeSuperpowersDogfoodMarkdown = async (markdown: string): Promise<string> => {
  const reportPath = join('docs', 'superpowers', 'reports', 'codex-runtime-real-dogfood-pass.md');
  const absolutePath = resolve(process.cwd(), reportPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, markdown, 'utf8');
  return reportPath;
};
```

Then call it from both PASS and BLOCKED paths. Keep `assertPublicSafeReport` before writing.

- [ ] **Step 5: Add test for BLOCKED file writer**

Add a unit test for the helper or reporter:

```ts
const markdown = renderCodexRuntimeSuperpowersDogfoodBlockerReport({
  status: 'BLOCKED',
  blocker_code: 'codex_runtime_superpowers_boundary_max_turns_exceeded',
  cleanup_status: 'blocked',
  codex_app_server_evidence: {
    phases: [
      {
        phase: 'spec',
        expected_output_schema_version: 'spec_revision.v1',
        observed_output_schema_versions: ['spec_revision.v1'],
        runtime_job_digests: [digest('spec-a')],
        app_server_evidence_digests: [digest('spec-app-server-a')],
        cleanup_status: 'blocked',
      },
    ],
  },
});
const written = await new FilesystemCodexRuntimeSuperpowersDogfoodReporter(tempRoot).writeMarkdown(markdown);
expect(written.report_path).toBe('docs/superpowers/reports/codex-runtime-real-dogfood-pass.md');
```

If you do not add `writeMarkdown`, expose a small `writeBlocked` method instead. The test must assert the rendered BLOCKED report contains `Cleanup status: blocked`, the phase name, and no raw path/container/endpoint values.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Attempt real dogfood command with current environment**

Run with the existing environment expected by the runbook, including explicit isolated worktree env from Task 6. Use proxy for network if needed:

```bash
FORGELOOP_CODEX_DOGFOOD_ISOLATED_WORKTREE=1 \
FORGELOOP_CODEX_DOGFOOD_REPO_BASE_BRANCH=main \
FORGELOOP_CODEX_DOGFOOD_REPO_PATH="$ISOLATED_MAIN_WORKTREE" \
HTTP_PROXY=http://127.0.0.1:7897 HTTPS_PROXY=http://127.0.0.1:7897 \
pnpm dogfood:codex-runtime:superpowers
```

Expected:
- PASS with `docs/superpowers/reports/codex-runtime-real-dogfood-pass.md`, or
- non-zero exit with a public-safe `BLOCKED` report at the same path.

Do not paste secrets or raw environment into the report. If the command blocks on missing env, invalid API key, Docker unavailable, image unavailable, quota, or network/proxy, leave the BLOCKED report as the truthful artifact.

- [ ] **Step 8: Inspect report safety**

Run:

```bash
rg -n "/Users/|/tmp/|~/.codex|OPENAI_API_KEY|Bearer |127\\.0\\.0\\.1|localhost|docker-exec:|auth\\.json|config\\.toml" docs/superpowers/reports/codex-runtime-real-dogfood-pass.md
```

Expected: no matches. If any match appears, fix redaction and rerun the focused tests plus the dogfood command.

- [ ] **Step 9: Commit Task 7**

Run:

```bash
git add scripts/codex-runtime-superpowers-dogfood.ts tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts docs/superpowers/reports/codex-runtime-real-dogfood-pass.md
git commit -m "test: close codex runtime real dogfood pass"
```

If the report is BLOCKED because of an external dependency, the commit message may still be the same as long as the report identifies the concrete public-safe blocker.

## Task 8: Final Verification And Review Prep

**Files:**
- Modify only if verification exposes a real bug in this slice.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts tests/smoke/codex-runtime-no-baggage-gate.test.ts tests/smoke/runbook-script-consistency.test.ts tests/api/brainstorming.test.ts tests/api/spec-plan-service.test.ts tests/api/executions.test.ts tests/api/codex-runtime-control-plane.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts tests/codex-worker-runtime/app-server-launcher.test.ts tests/codex-runtime/runtime.test.ts tests/codex-runtime/app-server-generation-driver.test.ts tests/domain/codex-runtime.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS. If any test fails, inspect the first failing assertion and fix only this slice.

- [ ] **Step 2: Run required guards**

Run:

```bash
pnpm check:codex-runtime-superpowers-no-baggage
pnpm check:runbook-scripts
```

Expected: both PASS.

- [ ] **Step 3: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Run diff check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Inspect final status**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
```

Expected:
- branch is `feature/codex-runtime-real-dogfood-pass`;
- only intended files are modified or all changes are committed;
- commits are scoped to the plan tasks.

- [ ] **Step 6: Prepare review summary**

Record in the final handoff:

- report path and status;
- whether real dogfood was PASS or BLOCKED;
- exact blocker code if BLOCKED;
- focused test command result;
- guard result;
- build result;
- `git diff --check` result.

- [ ] **Step 7: Use finishing workflow**

After all implementation tasks are complete and verified, use `superpowers:finishing-a-development-branch` to choose merge/PR/cleanup flow with the user.
