# P0 Strict Dogfood and Trace Evidence Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the P0 dogfood batch enforce strict local Codex acceptance, then add a reviewer-first Evidence Chain that explains reruns, required artifacts, and redacted evidence.

**Architecture:** Phase 1 hardens the existing P0 dogfood and local Codex boundary. Phase 2 records the P1 decision in docs. Phase 3 adds a minimal trace layer plus a read-time Evidence Chain projection so old records still render and the web never sees raw internals.

**Tech Stack:** TypeScript, Zod, NestJS, Drizzle/PostgreSQL, React/Vite, Vitest, Supertest, Playwright, Git worktrees.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-08-p0-strict-and-trace-evidence-design.md`
- Dogfood runbook: `docs/dogfood/p0-dogfood-work-items.md`
- Dogfood completion report: `docs/superpowers/reports/p0-dogfood-work-items-completion.md`
- Long-running execution spec: `docs/superpowers/specs/2026-05-06-codex-long-running-execution-design.md`
- Prior plan style references:
  - `docs/superpowers/plans/2026-05-07-codex-long-running-execution.md`
  - `docs/superpowers/plans/2026-05-08-p0-dogfood-readiness.md`

## Scope Guardrails

- Implement the strict P0 batch first. Do not start release, deploy, incident, or broader trace productization work in this plan.
- Keep `pnpm dogfood:p0:work-items` as the default command. `FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1` only enables the strict local Codex path.
- Keep `.worktrees/**` and `.superpowers/**` ignored by git. The local Codex workspace boundary stays `repo/.worktrees/<run-session-id>`.
- Do not expose `raw_ref`, raw logs, `ArtifactRef.local_ref`, or internal payloads in public Evidence Chain responses or the web UI.
- Do not infer supersession from timestamps alone. Replacement relationships must be persisted.
- Do not backfill historical trace data in one shot. The first read model must still work when trace tables are empty.
- Keep the Evidence Chain inside the existing workbench. No new product route or graph visualization.

## Target File Structure

```text
packages/contracts/src/
  api.ts                            # Public Evidence Chain DTOs, trace enums, and response schemas
  index.ts                          # Export new schemas and types

packages/domain/src/
  completion.ts                     # Strict success contract helper; required artifact predicate
  types.ts                          # Trace/event/link domain records and run replacement payload types
  index.ts                          # Export new domain types

packages/db/src/schema/
  _shared.ts                        # Trace enums
  evidence.ts                       # trace_events, trace_links, trace_artifact_refs tables
  index.ts                          # Export new tables

packages/db/src/repositories/
  p0-repository.ts                  # Trace write/list methods
  in-memory-p0-repository.ts        # In-memory trace storage and query support
  drizzle-p0-repository.ts          # PostgreSQL trace storage and query support

packages/workflow/src/
  activities.ts                     # Repository interface extension for trace writes
  execution-finalizer.ts            # Emit trace evidence for terminal run/review artifacts

apps/control-plane-api/src/p0/
  evidence-chain.ts                 # Read-time Evidence Chain projection helper
  p0.service.ts                     # Evidence Chain endpoint and rerun supersession write path
  p0.controller.ts                 # Route wiring
  run-session-serialization.ts      # Public redaction helper reused by the new chain

apps/web/src/
  api.ts                            # Evidence Chain client and request helpers
  workbenchState.ts                 # Evidence Chain grouping/sorting helpers
  App.tsx                           # Evidence Chain section in the workbench
  styles.css                        # Compact Evidence Chain layout and redaction styling

scripts/
  p0-dogfood-work-items.ts          # Strict batch selection, report generation, and blocker output
  p0-local-codex-dogfood.ts         # Local Codex dogfood preflight/report helpers used by strict mode

docs/
  dogfood/p0-dogfood-work-items.md   # Strict dirty allowlist and P1 decision summary
  superpowers/reports/p0-dogfood-work-items-completion.md
  superpowers/decisions/2026-05-08-p1-trace-evidence-plane.md

tests/
  contracts/run-events.test.ts
  contracts/evidence-chain.test.ts
  contracts/contracts.test.ts
  domain/validators.test.ts
  db/schema.test.ts
  db/repository.test.ts
  executor/local-codex-preflight.test.ts
  executor/source-repo-guard.test.ts
  executor/codex-worktree.test.ts
  api/evidence-chain.test.ts
  helpers/p0-runtime-fixtures.ts
  web/api.test.ts
  web/run-console-state.test.ts
  web/evidence-chain-state.test.ts
  e2e/run-console.e2e.test.ts
  smoke/p0-dogfood-work-items-script.test.ts
  smoke/p0-local-codex-dogfood-script.test.ts
  workflow/execution-finalizer.test.ts
```

## Task 1: Shared Contracts and Strict Success Predicate

**Files:**
- Modify: `packages/contracts/src/api.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/domain/src/completion.ts`
- Modify: `packages/domain/src/types.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `tests/contracts/run-events.test.ts`
- Create: `tests/contracts/evidence-chain.test.ts`
- Modify: `tests/contracts/contracts.test.ts`
- Modify: `tests/domain/validators.test.ts`

- [ ] **Step 1: Write the failing DTO and completion tests**

Add contract coverage for:
- `EvidenceChainResponse` with `focus`, `projection`, `summary`, and `items`.
- Canonical `risk_flags`, `redaction_reason`, and `projection_gap_codes` enums.
- `trace_links.relationship` restricted to `belongs_to`, `generated_by`, `supports`, `supersedes`, `replaces`, and `redacted_from`.
- The required artifact contract where `logs` are satisfied by `RunSession.log_refs[].kind` and all other kinds come from `RunSession.artifacts[]`.

Run:

```bash
pnpm test tests/contracts/run-events.test.ts tests/contracts/evidence-chain.test.ts tests/contracts/contracts.test.ts tests/domain/validators.test.ts
```

Expected: FAIL with missing `evidenceChainResponseSchema` exports and at least one red test proving `deriveWorkItemCompletion()` still ignores required `logs` evidence.

- [ ] **Step 2: Implement the shared schemas and helper**

Add the new DTO schemas in `packages/contracts/src/api.ts`, export them from `packages/contracts/src/index.ts`, and update `deriveWorkItemCompletion()` to call a shared required-artifact predicate that treats `logs` as satisfied by `log_refs`.

- [ ] **Step 3: Re-run the focused contract and domain tests**

Run the same `pnpm test ...` command again.

Expected: PASS.

- [ ] **Step 4: Commit the contract boundary**

```bash
git add packages/contracts/src/api.ts packages/contracts/src/index.ts packages/domain/src/completion.ts packages/domain/src/types.ts packages/domain/src/index.ts tests/contracts/run-events.test.ts tests/contracts/evidence-chain.test.ts tests/contracts/contracts.test.ts tests/domain/validators.test.ts
git commit -m "feat: add strict evidence contracts"
```

## Task 2: Strict Local Codex Boundary and Preflight

**Files:**
- Modify: `scripts/p0-local-codex-dogfood.ts`
- Modify: `packages/executor/src/local-codex-preflight.ts`
- Modify: `packages/executor/src/codex-worktree.ts`
- Modify: `packages/executor/src/source-repo-guard.ts`
- Modify: `packages/executor/src/local-codex-executor.ts`
- Modify: `tests/executor/local-codex-preflight.test.ts`
- Create: `tests/executor/source-repo-guard.test.ts`
- Modify: `tests/executor/codex-worktree.test.ts`
- Modify: `tests/smoke/p0-local-codex-dogfood-script.test.ts`

- [ ] **Step 1: Write the failing strict preflight tests**

Cover:
- blocker codes for missing `codex`, unauthenticated runtime, unconfirmed dangerous/yolo mode, dirty source checkout, durable repo unavailable, and worktree preparation failure;
- allowlist handling for the strict dogfood dirty source paths;
- `.worktrees/**` being ignored by the dirty fingerprint and not reported as source dirtiness;
- worktree paths resolving under `.worktrees/<run-session-id>`.

Run:

```bash
pnpm test tests/executor/local-codex-preflight.test.ts tests/executor/codex-worktree.test.ts tests/executor/source-repo-guard.test.ts tests/smoke/p0-local-codex-dogfood-script.test.ts
```

Expected: FAIL with missing structured blocker results and/or dirty-source assertions.

- [ ] **Step 2: Implement the strict preflight contract**

Teach the local Codex dogfood path to return a structured `StrictPreflightResult` with the exact blocker codes from the spec, keep the strict allowlist in one place, and make the worktree and source-repo helpers agree on `.worktrees/<run-session-id>`.

- [ ] **Step 3: Re-run the strict preflight tests**

Run the same `pnpm test ...` command again.

Expected: PASS.

- [ ] **Step 4: Commit the strict boundary**

```bash
git add scripts/p0-local-codex-dogfood.ts scripts/p0-dogfood-work-items.ts packages/executor/src/local-codex-preflight.ts packages/executor/src/codex-worktree.ts packages/executor/src/source-repo-guard.ts packages/executor/src/local-codex-executor.ts tests/executor/local-codex-preflight.test.ts tests/executor/source-repo-guard.test.ts tests/executor/codex-worktree.test.ts tests/smoke/p0-local-codex-dogfood-script.test.ts
git commit -m "feat: harden local codex preflight"
```

## Task 3: P0 Dogfood Batch, Report, and Decision Record

**Files:**
- Modify: `scripts/p0-dogfood-work-items.ts`
- Modify: `docs/dogfood/p0-dogfood-work-items.md`
- Modify: `docs/superpowers/reports/p0-dogfood-work-items-completion.md`
- Create: `docs/superpowers/decisions/2026-05-08-p1-trace-evidence-plane.md`
- Modify: `tests/smoke/p0-dogfood-work-items-script.test.ts`

- [ ] **Step 1: Write the failing batch/report tests**

Make the smoke coverage assert:
- default mode reports `Strict local_codex acceptance: disabled`;
- strict mode can emit `passed` or `failed`;
- strict mode fails when fewer than two Work Items satisfy the full Work Item-level Strict Success Contract;
- strict mode does not count a `local_codex` succeeded RunSession without a completed and approved Review Packet for the same Execution Package and RunSession;
- strict mode does not count approved Review Packets for `mock` or `workflow_only=true` runs;
- strict mode does not count a Work Item when any Execution Package on that Work Item is incomplete;
- strict mode fails when a qualifying `local_codex` Work Item is missing any `required_artifact_kinds`;
- the report lists per-item `executor_type`, `workflow_only`, run session ids, and review packet ids;
- the report includes strict blocker codes and the dirty allowlist source when strict mode fails;
- the runbook includes the strict dirty source allowlist subsection and the final P1 decision summary.

Run:

```bash
pnpm test tests/smoke/p0-dogfood-work-items-script.test.ts
```

Expected: FAIL because the report does not yet include strict mode fields and the decision summary.

- [ ] **Step 2: Implement the batch selection and report output**

Teach `scripts/p0-dogfood-work-items.ts` to:
- keep the browser walkthrough on `mock` / `workflow_only=true`;
- run the remote CI and durable verification items through `local_codex` / `workflow_only=false` when strict mode is enabled;
- compute strict acceptance from the Work Item-level contract: every package complete through `deriveWorkItemCompletion(...).done`, current RunSession is `local_codex` / `workflow_only=false` / `succeeded`, the same package/run has a completed approved Review Packet, and required artifacts are present;
- reject partial success instead of counting RunSession success alone, including fewer than two qualifying Work Items, mock/workflow-only approvals, unapproved packets, missing artifacts, and incomplete extra packages;
- collect and print strict blocker details;
- write the report fields required by the spec.

Update the runbook with the strict dirty allowlist and keep it mirrored in the implementation constant:
- `docs/superpowers/reports/p0-dogfood-work-items-completion.md`
- `.superpowers/**`

Add the P1 decision summary that chooses Trace / Evidence Plane.

- [ ] **Step 3: Re-run the smoke test**

Run:

```bash
pnpm test tests/smoke/p0-dogfood-work-items-script.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the dogfood batch and decision docs**

```bash
git add scripts/p0-dogfood-work-items.ts docs/dogfood/p0-dogfood-work-items.md docs/superpowers/reports/p0-dogfood-work-items-completion.md docs/superpowers/decisions/2026-05-08-p1-trace-evidence-plane.md tests/smoke/p0-dogfood-work-items-script.test.ts
git commit -m "feat: finalize p0 dogfood decision record"
```

## Task 4: Trace Schema, Repository, and Supersession Writes

**Files:**
- Modify: `packages/db/src/schema/_shared.ts`
- Modify: `packages/db/src/schema/evidence.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/repositories/p0-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-p0-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-p0-repository.ts`
- Modify: `packages/workflow/src/activities.ts`
- Modify: `packages/workflow/src/execution-finalizer.ts`
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Modify: `tests/db/schema.test.ts`
- Modify: `tests/db/repository.test.ts`
- Modify: `tests/api/delivery-flow.test.ts`
- Modify: `tests/workflow/execution-finalizer.test.ts`
- Modify: `tests/helpers/p0-runtime-fixtures.ts`

- [ ] **Step 1: Write the failing trace persistence tests**

Cover:
- the new `trace_events`, `trace_links`, and `trace_artifact_refs` tables;
- the trace relationship enum;
- repository save/list behavior for trace rows;
- persisted `run_replacement_recorded` links with `supersedes` and `replaces`;
- API rerun flow coverage for `run_replacement_recorded` payload direction and the later `new_review_packet_id` update;
- trace writes emitted when the workflow finalizer records terminal evidence;
- trace write failures in the API rerun path leave the primary rerun transaction committed and still reconstructable by the read-time helper;
- trace write failures in the workflow finalizer leave terminal RunSession, Review Packet, artifact, and decision records intact.

Run:

```bash
pnpm test tests/db/schema.test.ts tests/db/repository.test.ts tests/api/delivery-flow.test.ts tests/workflow/execution-finalizer.test.ts
```

Expected: FAIL because the new trace schema and repository methods do not exist yet.

- [ ] **Step 2: Implement the trace tables and repository methods**

Add the trace tables to `packages/db/src/schema/evidence.ts`, export them, extend the repository interface, and wire the in-memory and Drizzle implementations.

- [ ] **Step 3: Add the supersession trace writes**

Extend the workflow finalizer and the API rerun path so a rerun records the persisted replacement relationship instead of inferring it from timestamps.
Make these trace writes best-effort around the already-durable P0 transaction: catch trace persistence failures, preserve the primary rerun/finalizer result, and rely on the read-time Evidence Chain helper to project partial evidence from existing P0 tables when trace rows are missing.

- [ ] **Step 4: Re-run the trace persistence tests**

Run the same `pnpm test ...` command again.

Expected: PASS.

- [ ] **Step 5: Commit the trace persistence layer**

```bash
git add packages/db/src/schema/_shared.ts packages/db/src/schema/evidence.ts packages/db/src/schema/index.ts packages/db/src/repositories/p0-repository.ts packages/db/src/repositories/in-memory-p0-repository.ts packages/db/src/repositories/drizzle-p0-repository.ts packages/workflow/src/activities.ts packages/workflow/src/execution-finalizer.ts apps/control-plane-api/src/p0/p0.service.ts tests/db/schema.test.ts tests/db/repository.test.ts tests/api/delivery-flow.test.ts tests/workflow/execution-finalizer.test.ts tests/helpers/p0-runtime-fixtures.ts
git commit -m "feat: persist trace evidence links"
```

## Task 5: Evidence Chain Read Model and API

**Files:**
- Create: `apps/control-plane-api/src/p0/evidence-chain.ts`
- Modify: `apps/control-plane-api/src/p0/p0.controller.ts`
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Modify: `apps/control-plane-api/src/p0/run-session-serialization.ts`
- Create: `tests/api/evidence-chain.test.ts`
- Modify: `tests/helpers/p0-runtime-fixtures.ts`

- [ ] **Step 1: Write the failing Evidence Chain API tests**

Cover:
- `GET /work-items/:workItemId/evidence-chain`;
- `GET /work-items/:workItemId/evidence-chain?review_packet_id=:reviewPacketId`;
- explicit `review_packet_id` belonging to the work item;
- `focus.selection` switching between `current` and `explicit`;
- `projection.partial` and gap codes for missing trace coverage;
- `risk_flags` for no evidence, missing artifacts, redaction, supersession, stale packets, failed checks, and changes requested;
- `changes_requested -> rerun -> approve` evidence where current evidence appears before superseded history;
- unlinked historical reruns remaining visible without timestamp-inferred supersession;
- required `logs` artifacts satisfying presence through `RunSession.log_refs` while staying redacted from public output;
- 404 when the work item does not exist or the review packet is outside the work item.

Run:

```bash
pnpm test tests/contracts/evidence-chain.test.ts tests/api/evidence-chain.test.ts
```

Expected: FAIL because the endpoint, helper, and redaction logic are missing.

- [ ] **Step 2: Implement the read-time projection helper**

Build the chain from existing P0 tables first, then overlay trace rows when present. Keep the projection metadata explicit and make the redaction helper hide raw/internal evidence.

- [ ] **Step 3: Wire the route into the controller and service**

Expose the new endpoint in `P0Controller`, keep `run_session` public serializers redacted, and reuse the same public evidence filter for the Evidence Chain.

- [ ] **Step 4: Re-run the API tests**

Run:

```bash
pnpm test tests/contracts/evidence-chain.test.ts tests/api/evidence-chain.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the API surface**

```bash
git add apps/control-plane-api/src/p0/evidence-chain.ts apps/control-plane-api/src/p0/p0.controller.ts apps/control-plane-api/src/p0/p0.service.ts apps/control-plane-api/src/p0/run-session-serialization.ts tests/contracts/evidence-chain.test.ts tests/api/evidence-chain.test.ts tests/helpers/p0-runtime-fixtures.ts
git commit -m "feat: add evidence chain api"
```

## Task 6: Web Workbench, Browser Coverage, and Final Verification

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/workbenchState.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `tests/web/api.test.ts`
- Create: `tests/web/evidence-chain-state.test.ts`
- Modify: `tests/web/run-console-state.test.ts`
- Modify: `tests/e2e/run-console.e2e.test.ts`

- [ ] **Step 1: Write the failing web and browser tests**

Cover:
- the new client request helper for the Evidence Chain endpoint;
- summary count and item grouping helpers;
- redaction markers without raw log links;
- browser rendering of the Evidence Chain section in the existing workbench;
- linear ordering with current focus first and superseded history second.

Run:

```bash
pnpm test tests/web/api.test.ts tests/web/run-console-state.test.ts tests/web/evidence-chain-state.test.ts tests/e2e/run-console.e2e.test.ts
```

Expected: FAIL because the client, state helpers, and UI section are missing.

- [ ] **Step 2: Implement the workbench UI**

Add the Evidence Chain data fetch to the current workbench refresh path, render the summary and item list near the existing cockpit/timeline panels, and keep the layout dense and compact.

- [ ] **Step 3: Re-run the focused web tests**

Run:

```bash
pnpm test tests/web/api.test.ts tests/web/run-console-state.test.ts tests/web/evidence-chain-state.test.ts tests/e2e/run-console.e2e.test.ts
pnpm --filter @forgeloop/web build
```

Expected: PASS.

- [ ] **Step 4: Commit the UI surface**

```bash
git add apps/web/src/api.ts apps/web/src/workbenchState.ts apps/web/src/App.tsx apps/web/src/styles.css tests/web/api.test.ts tests/web/evidence-chain-state.test.ts tests/web/run-console-state.test.ts tests/e2e/run-console.e2e.test.ts
git commit -m "feat: render evidence chain in the workbench"
```

## Task 7: Final Verification and Cleanup

- [ ] **Step 1: Run the full validation set**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: PASS.

- [ ] **Step 2: Fix any residual blockers in the smallest task that owns them**

If one of the verification commands fails, return to the narrowest affected task, fix the issue, and re-run the same command before moving on.

- [ ] **Step 3: Make the final commit if any follow-up edits were required**

```bash
git add -A
git commit -m "feat: complete strict dogfood and evidence chain"
```
