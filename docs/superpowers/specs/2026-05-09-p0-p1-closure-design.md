# P0/P1 Closure Design

## Status

Draft for review.

## Context

ForgeLoop has a green baseline on `main`: full tests pass, build passes, the worktree is clean, CI exists, and the reviewer-first Evidence Chain API and Workbench UI are implemented. The remaining uncertainty is not broad feature availability. It is whether the current P0/P1 phase has been closed with strict evidence and whether project planning documents still reflect reality.

The current dogfood completion report explicitly says strict `local_codex` acceptance is disabled. Several plan documents still contain unchecked implementation steps even though recent commits show the corresponding functionality exists. The P1 decision also names follow-up candidates, but Release, Retrospective, and Trace projector/backfill are separate product surfaces and should not be pulled into this closure batch.

## Problem

The project can appear unfinished for three different reasons:

- strict `local_codex` dogfood has not been completed or recorded as blocked;
- plan checkboxes are stale relative to the code and verification state;
- follow-up product ideas remain intentionally deferred.

Treating all three as one implementation batch would either under-verify P0/P1 or expand into new P2-style product work. This closure pass must separate phase completion from future product scope.

## Goals

- Run or explicitly block strict `local_codex` P0 dogfood acceptance.
- Refresh completion evidence so reports distinguish deterministic mock dogfood, durable/browser verification, and strict real-Codex acceptance.
- Synchronize relevant plan/checklist status with the implemented code and current verification results.
- Apply only narrow hardening needed to make closure evidence trustworthy, such as report accuracy, redaction metadata gaps, and noisy verification output.
- Keep full verification green after any changes.

## Non-Goals

- Do not build Release grouping or rollout approval.
- Do not build Retrospective / Learning Loop.
- Do not add Trace projector/backfill jobs unless a tiny metadata change is required for current Evidence Chain correctness.
- Do not rewrite the Workbench or introduce a new Evidence Chain product route.
- Do not claim strict acceptance when the environment blocks real `local_codex` execution.

## Proposed Approach

Use a closure-first approach:

1. Establish a fresh verification baseline with `pnpm test`, `pnpm build`, and `git diff --check`.
2. Prepare local durable dependencies and run schema push.
3. Run strict `FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 pnpm dogfood:p0:work-items`.
4. If strict mode passes, update the dogfood completion report with the strict pass evidence.
5. If strict mode is blocked, preserve the failure, record blocker codes and command output, and keep deterministic dogfood status separate from strict acceptance.
6. Audit relevant plan docs against actual files and tests, then mark only verified items complete or add a short completion note explaining why old unchecked items are stale.
7. Apply minimal hardening only when it directly supports closure evidence.
8. Re-run focused tests for touched areas, then full test/build verification.

This is preferred over a documentation-only sweep because it produces real acceptance evidence. It is also preferred over starting all follow-up product work because it keeps the phase boundary clear.

## Components

### Strict Dogfood Verification

The strict path uses the existing `scripts/p0-dogfood-work-items.ts` behavior. Two Work Items should run with `executor_type: local_codex` and `workflow_only=false`; one mock Work Item should keep the `changes_requested -> rerun -> approve` path. The script remains the source of truth for strict qualifying Work Items.

The closure pass must not relax strict preflight. Missing Codex auth, dirty source checkout, unavailable durable dependencies, or worktree failures are valid blockers and should be recorded rather than bypassed.

### Evidence And Reports

The dogfood completion report should state one of:

- strict acceptance passed, with qualifying Work Items, run session IDs, review packet IDs, and required artifacts;
- strict acceptance failed or blocked, with concrete blocker details;
- strict acceptance disabled only when strict mode was not attempted.

The durable/browser verification report should stay accurate and should not imply strict real-Codex acceptance.

### Plan Synchronization

Plan docs are advisory records, not runtime truth. The closure pass should update the relevant P0/P1 plan document so a future reader can tell which steps are already implemented, which were superseded by later commits, and which remain intentionally deferred.

Do not blindly mark every unchecked box across old plans. Older historical plans may remain as history. Prefer a current closure note or targeted checkbox updates where the repository provides direct evidence.

### Narrow Hardening

Hardening is limited to issues found while closing the phase:

- redaction metadata fields if current trace records cannot clearly represent public vs internal evidence;
- noisy tests if expected configuration errors obscure real failures;
- report generation if strict outcomes are ambiguous;
- missing tests around any touched closure behavior.

## Data Flow

Strict dogfood produces Work Items, Specs, Plans, Execution Packages, RunSessions, Review Packets, trace/evidence rows, and report markdown. The closure pass reads those outputs and updates reports/docs. It should not introduce a separate source of truth for completion.

If strict dogfood is blocked before creating product records, the report should record the blocker state and the command should remain non-successful for strict acceptance. Deterministic mock dogfood may still pass independently.

## Error Handling

- Environment blockers are captured with command, status, and concise explanation.
- Strict local Codex failure does not get converted into deterministic success.
- If Docker or Postgres is unavailable, record that as infrastructure blocker and avoid changing product code unless the blocker is caused by repository code.
- If plan docs conflict with code, prefer current tests and source files, then document the reconciliation.

## Testing

Required verification for this closure pass:

- `pnpm test`
- `pnpm build`
- `git diff --check`
- `FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm db:push` when Postgres is available
- `FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 FORGELOOP_REPO_PATH=/Users/viv/projs/forgeloop pnpm dogfood:p0:work-items` for strict acceptance

If strict dogfood cannot run to completion because of local environment constraints, the final verification must still include full tests/build and a documented blocker.

## Acceptance Criteria

- The final report clearly says whether strict `local_codex` acceptance passed, failed, or was blocked.
- Any blocker includes enough command evidence for the next operator to reproduce it.
- Relevant P0/P1 planning docs no longer make completed Evidence Chain work look unstarted.
- No Release, Retrospective, or broad Trace backfill product work is added.
- Full test/build verification passes after changes, or any failure is explicitly documented with the narrow next fix.
