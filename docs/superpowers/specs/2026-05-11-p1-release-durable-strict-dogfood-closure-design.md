> Superseded historical migration note: this document mentions the old subsystem name for audit history only. Current commands, routes, files, and product docs use delivery terminology.

# P1 Release Durable And Strict Dogfood Closure Design

## Status

Draft for review.

## Context

Release Risk Radar is implemented and pushed to `main`. The current verification report at `docs/superpowers/reports/p1-release-risk-radar-verification.md` proves the deterministic in-memory Release flow:

- P0 delivery path
- Release create/link/submit
- Release approval or override approval
- Release observing/close
- Release cockpit query
- Release replay redaction
- Release observation backlink projection

Two Release verification markers remain environment-dependent and are still correctly reported as blocked:

- Durable local reset
- Strict local_codex run

This work closes those markers without weakening the existing rule: ForgeLoop must not claim a dogfood check passed unless it actually ran and verified the required evidence.

## Problem

`pnpm dogfood:release-flow` currently boots a deterministic in-memory Nest app and writes a report. That is useful for fast local and CI smoke coverage, but it cannot prove:

- Release data survives a durable Postgres-backed reset/push/run path.
- Release cockpit and replay stay safe when the run evidence comes from a real `local_codex` execution path.
- The Release verification report can distinguish blocked environment prerequisites from real failures and real passes.

P0 already has durable and strict dogfood scripts, but those scripts prove the P0 delivery loop. They do not prove the Release lifecycle, Release links, Release cockpit, or Release replay in durable and strict conditions.

## Goals

- Keep the default Release dogfood deterministic and fast.
- Add an opt-in strict Release dogfood closure command.
- Prove Release flow against a reset durable Postgres database when a safe database is available.
- Prove a real strict `local_codex` run can be linked into a Release and inspected safely through Release cockpit and replay.
- Update the Release verification report so `PASSED`, `BLOCKED with reason`, and `FAILED` have precise, enforceable meanings.
- Extract reusable dogfood harness helpers instead of copying P0 durable and strict logic into the Release script.
- Keep this scope limited to Release dogfood closure.

## Non-Goals

- Do not build new Incident, Retrospective, Trace, Contract, Mock, Fixture, CI/CD, deployment, monitoring, or alerting product surfaces.
- Do not change Release product behavior except where required to run and verify the dogfood closure.
- Do not make the default `dogfood:release-flow` command depend on Docker, Postgres, Codex authentication, or dangerous local Codex confirmation.
- Do not mark blocked environment checks as passed.
- Do not write raw database URLs, absolute source paths, secrets, raw executor metadata, or private runtime metadata into the Release verification report.

## Source Documents

- `docs/PRD_v1.md`
- `docs/architecture-design/v0/entity-design.md`
- `docs/architecture-design/v0/query.md`
- `docs/architecture-design/v0/trace-evidence-plane.md`
- `docs/superpowers/specs/2026-05-11-p1-release-risk-radar-product-surface-design.md`
- `docs/superpowers/plans/2026-05-11-p1-release-risk-radar-product-surface.md`
- `docs/superpowers/reports/p1-release-risk-radar-verification.md`
- `docs/superpowers/reports/p0-delivery-loop-verification.md`

## Current Implementation Baseline

Relevant commands:

- `pnpm dogfood:release-flow`
- `pnpm dogfood:p0`
- `pnpm dogfood:p0:durable`
- `pnpm dogfood:p0:local-codex`
- `pnpm dogfood:p0:work-items`

Relevant scripts:

- `scripts/release-flow-dogfood.ts`
- `scripts/p0-durable-dogfood.ts`
- `scripts/p0-local-codex-dogfood.ts`
- `scripts/p0-dogfood.ts`
- `scripts/p0-dogfood-work-items.ts`

Relevant support:

- `packages/db/src/client.ts`
- `packages/db/src/reset.ts`
- `apps/control-plane-api/src/p0/p0.module.ts`
- `apps/control-plane-api/src/modules/release/*`
- `apps/control-plane-api/src/modules/query/*`

## Recommended Approach

### A. Add A Shared Dogfood Closure Harness

Create shared dogfood helpers for durable Postgres setup, strict local Codex preflight/evidence, and report status rendering. Then use them from a new Release strict closure command.

This is recommended because it avoids duplicating the P0 dogfood machinery and keeps both P0 and Release dogfood checks aligned over time.

### B. Add Release-Specific Strict Logic Only

Build the strict Release command by copying or directly importing pieces from the P0 scripts.

This is faster initially, but it leaves two dogfood systems with subtly different environment checks, cleanup behavior, and report semantics. That creates future drift.

### C. Merge Strict Behavior Into The Default Release Script

Make `pnpm dogfood:release-flow` attempt durable and strict checks whenever the environment allows it.

This over-couples the fast deterministic smoke command to local operator setup. It would make normal verification noisier and easier to misread.

## Architecture

### Command Split

Keep:

- `dogfood:release-flow`: deterministic in-memory Release smoke. It may write blocked markers for environment-dependent checks, but it must not attempt strict infrastructure by default.

Add:

- `dogfood:release-flow:strict`: opt-in Release dogfood closure. It attempts durable reset and strict local Codex verification. It exits non-zero when required strict closure cannot run or fails, unless the caller explicitly allows blocked report generation.

Optional report-only override:

- `FORGELOOP_RELEASE_FLOW_STRICT_ALLOW_BLOCKED=1`: lets the strict command write a blocked report and exit zero for documentation workflows. This must not be enabled by default.

### Shared Durable Dogfood Harness

Move reusable durable database behavior out of P0-only script code into a shared script helper, for example:

`scripts/dogfood/durable-postgres.ts`

The helper should own:

- validating the selected database URL is safe before any schema mutation;
- reading provided `FORGELOOP_DATABASE_URL`;
- discovering a running Docker Postgres container;
- starting a disposable container when `FORGELOOP_DOGFOOD_START_POSTGRES=1`;
- creating a timestamped disposable database whose name is resettable under `packages/db/src/reset.ts`, for example `forgeloop_tmp_dogfood_<timestamp>`;
- calling safe reset logic for provided local databases;
- pushing schema only after the target has passed safety validation;
- dropping disposable databases;
- removing disposable containers;
- redacting database identity in reports.

`scripts/p0-durable-dogfood.ts` and the new Release strict command should use this helper so durable setup and cleanup rules stay identical.

The durable helper contract should expose separate phases:

- `prepareSafeDatabaseTarget`: resolve the database target and run `assertResettableDatabaseUrl()` or an equivalent safety check before any schema operation;
- `pushSchema`: run `pnpm db:push` with `FORGELOOP_DATABASE_URL` set explicitly to the prepared safe database URL;
- `resetDatabase`: run `resetForgeloopDatabase()` after schema push and before dogfood data creation;
- `cleanupDatabaseTarget`: close clients, drop disposable databases, and remove disposable containers.

For provided databases, a non-local URL, a non-resettable database name, or missing reset confirmation is `BLOCKED with reason` and must prevent `db:push`. For disposable databases, the helper must choose a resettable name rather than relying on `FORGELOOP_CONFIRM_DB_RESET=1`.

### Shared Strict Local Codex Harness

Move reusable strict local Codex preflight and evidence checks into a shared helper, for example:

`scripts/dogfood/strict-local-codex.ts`

The helper should own:

- opt-in enablement through `FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1`;
- dangerous mode confirmation through `FORGELOOP_LOCAL_CODEX_DOGFOOD_CONFIRM_DANGEROUS_MODE=1`;
- `codex` command availability and authentication checks;
- source checkout dirty checks and explicit dirty allowlist behavior;
- isolated worktree creation probe;
- source guard injection;
- terminal evidence validation;
- live event observation validation;
- Review Packet artifact/path validation in memory only;
- blocker rendering with stable blocker codes.

Dirty source handling must be explicit. The shared helper should use a named allowlist source, `STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST`, with only repository-relative entries. For Release closure, the default allowed dirty entries are:

- `docs/superpowers/reports/p1-release-risk-radar-verification.md`;
- `.superpowers/**`.

Those entries may be accepted by default so a previous report or local superpowers state does not block strict preflight. Any other dirty entry is `source_dirty_blocked`. Report rendering must sanitize dirty details and must not emit absolute paths.

The helper should not know P0 or Release product semantics. Product-specific scripts provide the execution package, API flow, and object assertions.

### Release Flow Runner

Refactor `scripts/release-flow-dogfood.ts` around a reusable runner instead of a fixed in-memory app setup.

The runner should accept:

- repository instance;
- durability mode;
- actor identity mode;
- optional run evidence source;
- report mode label.

The deterministic command uses:

- `InMemoryP0Repository`;
- `RUN_DURABILITY_MODE=volatile_demo`;
- demo actor body fallback allowed;
- seeded mock run evidence.

The strict durable command uses:

- `createDbClient + createDrizzleP0Repository`;
- `RUN_DURABILITY_MODE=durable`;
- demo actor body fallback disabled;
- actor headers for durable mutations that require authenticated actors;
- either a real local Codex run or an explicit blocker.

Durable Release dogfood must also seed durable identity records before public API commands that reference them:

- one organization with a UUID id;
- owner, reviewer, and QA actors with UUID ids in that organization;
- a durable project associated with that organization and owner actor.

The implementation may seed these records directly through the repository or DB helper before public API calls. It must not rely on volatile demo ids such as `org-1`, `actor-owner`, `actor-reviewer`, or `actor-qa` in durable mode. Public durable API calls must use `X-Forgeloop-Actor-Id` with the seeded UUID actors; body actor fields may be included only when the current route DTO requires them, and they must match the authenticated actor when the route treats body actor as owner/reviewer input.

### Release Strict Closure Runner

The strict Release command should run this sequence:

1. Resolve and prepare a safe durable database.
2. Validate that the database target is resettable before any schema mutation.
3. Run `pnpm db:push` against that validated database.
4. Reset the database before Release dogfood data is created.
5. Seed durable organization, actor, and project identity rows with UUID ids.
6. Start a durable Nest app using the Drizzle repository.
7. Run the Release API lifecycle:
   - use the seeded durable Project and bind its repo through the public project repo API;
   - create WorkItem, Spec, Plan, and ExecutionPackage;
   - submit/approve the package path;
   - create Release;
   - link WorkItem and ExecutionPackage;
   - run strict `local_codex` preflight;
   - when strict preflight passes, create the bounded `local_codex` ExecutionPackage, run it, verify terminal evidence, and link it to the Release while the Release is still `draft` or `candidate`;
   - when strict preflight is blocked, keep the Release linked only to deterministic evidence and record `Strict local_codex run` as `BLOCKED with reason`;
   - submit Release for approval;
   - approve or override approve with a matching blocker snapshot;
   - start observing;
   - add observation evidence with Release backlinks and, when strict ran, public links to the `local_codex` ExecutionPackage and RunSession;
   - close Release.
8. Query `/query/release-cockpit/:releaseId`.
9. Query `/query/replay/release/:releaseId`.
10. Assert public output does not include unsafe internals.
11. Assert that any strict `local_codex` evidence linked before approval is projected only through public-safe fields.
12. Write the verification report.
13. Close the Nest app and database pools before dropping disposable databases.
14. Clean up durable resources.

## Data Flow

### Deterministic Flow

`dogfood:release-flow`

1. Create an in-memory repository.
2. Seed deterministic P0 package and mock run evidence.
3. Execute the Release lifecycle.
4. Query cockpit and replay.
5. Write deterministic `PASSED` markers.
6. Write durable and strict markers as `BLOCKED with reason`.
7. Exit zero if deterministic assertions pass.

### Strict Durable Flow

`dogfood:release-flow:strict`

1. Prepare Postgres.
2. Validate the target with reset-safety rules before running any schema mutation.
3. Push schema with `FORGELOOP_DATABASE_URL` explicitly set to the prepared safe URL.
4. Reset the database.
5. Create durable organization, actor, and project seed data only after reset completes.
6. Boot durable API with Drizzle repository.
7. Execute the Release lifecycle using durable-safe actor authentication.
8. Keep all Release linking operations before submit/approval/close because Release package links are only valid while the Release is still mutable.
9. Close and reopen repository or app where needed to prove durable reads are not memory-backed.
10. Verify Release cockpit and replay after the durable boundary.
11. Mark `Durable local reset` as `PASSED` only after safety validation, schema push, reset, durable lifecycle, and durable post-boundary reads succeed.

### Strict Local Codex Flow

`dogfood:release-flow:strict`

1. Run strict local Codex preflight.
2. If preflight fails, record `Strict local_codex run` as `BLOCKED with reason`.
3. If preflight passes, create a bounded `local_codex` package through public API before the Release is submitted for approval.
4. Run it with `executor_type=local_codex` and `workflow_only=false`.
5. Wait for terminal status.
6. Require:
   - run status `succeeded`;
   - public non-terminal live event before terminal completion;
   - changed files;
   - check results;
   - artifacts;
   - Review Packet artifact/path validated only in memory;
   - runtime metadata assertions in memory only.
7. Link the completed `local_codex` ExecutionPackage into the Release while the Release is still `draft` or `candidate`.
8. During the observation phase, add Release evidence with `extra.observation.links` that references:
   - `{ object_type: "release", object_id: releaseId, relationship: "observed" }`;
   - `{ object_type: "execution_package", object_id: localCodexPackageId, relationship: "supports" }`;
   - `{ object_type: "run_session", object_id: localCodexRunSessionId, relationship: "generated_by" }`.
9. Re-query Release cockpit and replay after the Release reaches its closed terminal state.
10. Mark `Strict local_codex run` as `PASSED` only after the package link, observation links, internal terminal evidence, cockpit projection, replay projection, and public safety assertions all succeed.

Internal terminal evidence and public projection are separate checks. Internal checks may inspect local paths and runtime metadata to prove the local Codex run used an isolated worktree and produced a Review Packet. Public report/cockpit/replay checks must expose only safe booleans, ids, artifact kinds, public-safe storage URIs, redaction statuses, and object links. Local-ref-only artifacts are expected to be absent or redacted from public projections unless the implementation creates an explicit public-safe `storage_uri`; strict `PASSED` must not require publishing local artifact paths.

## Report Semantics

The Release verification report remains:

`docs/superpowers/reports/p1-release-risk-radar-verification.md`

Allowed marker statuses:

- `PASSED`: the check executed and all assertions passed.
- `BLOCKED with reason`: the check did not run because an environment prerequisite or safety precondition was missing.
- `FAILED`: the check ran and an assertion failed.

The report must keep the existing required marker names:

- P0 delivery path
- Release create/link/submit
- Release approval or override approval
- Release observing/close
- Release cockpit query
- Release replay redaction
- Release observation backlink projection
- Durable local reset
- Strict local_codex run

Strict command exit behavior:

- The strict closure markers are `Durable local reset` and `Strict local_codex run`.
- If any required marker is `FAILED`, exit non-zero. This cannot be overridden.
- If every required marker is `PASSED`, exit `0`.
- If no marker is `FAILED` but either strict closure marker is `BLOCKED with reason`, exit non-zero by default.
- `FORGELOOP_RELEASE_FLOW_STRICT_ALLOW_BLOCKED=1` changes only the blocked-with-reason case to exit `0` for report-generation workflows. It must never mask `FAILED`.

Default command exit behavior:

- Exit `0` when deterministic assertions pass.
- Continue to write `BLOCKED with reason` for durable and strict markers when those checks are not attempted.

## Public Safety Requirements

The Release report, cockpit response, and replay response must not expose:

- raw database URLs;
- absolute source checkout paths;
- `.worktrees` absolute paths;
- `raw_metadata`;
- `runtime_metadata`;
- `allowed_paths`;
- `forbidden_paths`;
- `client_secret`;
- token-like or secret-like values.

Runtime metadata may be inspected inside the script for assertions. It must not be copied into the report or public Release cockpit/replay projections.

Strict local Codex report entries must sanitize blocker details before writing them. They may include blocker codes, short messages, allowed/blocked dirty entry basenames or repository-relative paths, counts, and boolean evidence flags. They must strip or hash absolute worktree paths, database URLs, local artifact paths, raw command stderr containing secrets, and runtime metadata.

## Error Handling

Environment blockers and failures should include stable codes and human-readable messages. The status must follow these rules:

- missing database, missing Docker, unsafe database target, reset safety refusal, missing Codex, unauthenticated Codex, unconfirmed dangerous mode, dirty source, and failed worktree probe are `BLOCKED with reason` because a required safety or environment precondition prevented the check from running;
- schema push attempted and failed is `FAILED` because the validated target existed and the check ran;
- reset attempted and failed after safety validation is `FAILED`;
- local Codex run reached a non-success terminal state is `FAILED`;
- missing terminal evidence after a completed local Codex run is `FAILED`;
- public projection leak is `FAILED`.

Examples:

- `missing_database`: no provided DB, no Docker Postgres, and disposable container startup not enabled.
- `database_reset_refused`: reset target is not safe under `packages/db/src/reset.ts` rules.
- `schema_push_failed`: `pnpm db:push` failed.
- `missing_codex_command`: `codex` is not available.
- `codex_not_authenticated`: `codex login status` failed.
- `dangerous_mode_unconfirmed`: dangerous local Codex mode was not explicitly confirmed.
- `source_dirty_blocked`: source checkout contains dirty entries outside the strict allowlist.
- `worktree_create_failed`: isolated worktree probe failed.
- `local_codex_terminal_failed`: real run reached a non-success terminal state.
- `missing_terminal_evidence`: real run did not produce the required public evidence.
- `public_projection_leak`: report/cockpit/replay included unsafe internals.

Cleanup must run in `finally` blocks:

- close Nest apps;
- close database pools;
- drop disposable databases;
- remove disposable containers;
- remove probe worktrees;
- restore source guard probe files.

Cleanup failures should be printed as cleanup errors but must not hide the primary failure.

## Testing Strategy

### Script Helper Tests

Extend smoke tests around dogfood helpers:

- report renderer preserves every required marker;
- strict closure command cannot render strict `PASSED` without evidence;
- blocked durable prerequisites render `BLOCKED with reason`;
- blocked local Codex preflight renders blocker codes;
- unsafe strings are rejected from report/cockpit/replay samples;
- strict command exit code rules distinguish passed, blocked, and failed states.

### Durable Tests

Tests that need a database should run only when `FORGELOOP_TEST_DATABASE_URL` or `FORGELOOP_DATABASE_URL` is available.

They should verify:

- safe reset is called before dogfood data creation;
- `pnpm db:push` is required before durable Release flow;
- durable app uses Drizzle repository and `RUN_DURABILITY_MODE=durable`;
- durable actor header paths are used where durable mode forbids demo actor body fallback;
- Release rows, links, decisions, evidences, and object events remain readable after a fresh repository/app boundary.

### Strict Local Codex Tests

Most strict local Codex behavior should be tested with stubbed command runners and fake API/run-session fixtures. A real Codex run remains opt-in dogfood, not a default test requirement.

Tests should verify:

- missing Codex, unauthenticated Codex, unconfirmed dangerous mode, dirty source, and failed worktree probe produce blocker status;
- source guard injection detects source checkout mutation and cleans up;
- runtime metadata assertions are used internally but not reported publicly;
- terminal evidence is required before strict `PASSED`;
- Release cockpit/replay assertions run after linking strict evidence.

### Verification Commands

Implementation should be verified with:

- `pnpm vitest run tests/smoke/release-flow-dogfood-script.test.ts`
- relevant new smoke/helper tests
- relevant Release API/query tests
- `pnpm dogfood:release-flow`
- `pnpm dogfood:release-flow:strict` in an environment with safe Postgres and strict local Codex configured
- `pnpm test`
- `pnpm build`

## Acceptance Criteria

- `dogfood:release-flow` still passes in a normal environment without Postgres or Codex.
- `dogfood:release-flow:strict` exists and is documented through `package.json`.
- The Release strict command uses a safe durable database reset and Drizzle-backed repository.
- The Release strict command uses strict local Codex preflight before any real local Codex run.
- The Release report never marks durable or strict checks `PASSED` unless the corresponding check actually ran and verified evidence.
- The Release report can represent blocked strict prerequisites with stable blocker details.
- The Release report contains no unsafe internals.
- P0 durable/local-codex dogfood behavior is not regressed by shared helper extraction.
- All relevant tests, `pnpm test`, and `pnpm build` pass before the work is considered complete.

## Out Of Scope For The Implementation Plan

- Designing new user-facing Release UI beyond the already implemented Release Risk Radar surface.
- Adding production deployment orchestration.
- Adding external monitoring integrations.
- Changing persistent schema unless implementation discovers a concrete Release closure blocker that cannot be solved with the current schema.
