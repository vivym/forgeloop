# Codex Runtime Real Dogfood Pass Design

## Status

User-approved design draft.

This spec defines the next Codex runtime closure slice after `docs/superpowers/specs/2026-05-25-codex-runtime-superpowers-dogfood-closure-design.md` landed on `main`. The previous slice established the product vocabulary, centralized Codex config/auth import path, strict remote worker scaffolding, and a Superpowers product-loop dogfood command. This slice must turn that scaffold into a real app-server dogfood pass and fix only blockers that prevent the pass from closing.

## Goal

Run a strict, same-host remote dogfood that proves ForgeLoop can drive a Development Plan Item through Codex-led Boundary Brainstorming, approved Boundary Summary, Spec generation, Execution Plan generation, and Execution using real Codex app-server jobs, centralized runtime profile/auth distribution, and per-task isolated `CODEX_HOME`.

The success path must not depend on worker-local `~/.codex`, a shared repository filesystem, CLI fallback, fixed two-round Boundary Brainstorming, or fixture-only product transitions.

## Context

The current `main` already contains the core primitives this pass should exercise:

- `packages/contracts/src/ai-project-management.ts` defines Development Plan Item leader fields, Boundary session statuses, Boundary rounds, questions, answers, decisions, and Boundary Summary revisions.
- `scripts/codex-runtime-import.ts` imports Codex `config.toml` and `auth.json` into centralized runtime profile and credential storage. Host-local Codex files are setup inputs only.
- `scripts/codex-remote-worker-dogfood.ts` starts remote-outbound workers and rejects direct config/auth/Codex home paths when `FORGELOOP_CODEX_NO_SHARED_FILESYSTEM=1`.
- `scripts/codex-runtime-superpowers-dogfood.ts` wires the strict product-loop dogfood command, report redaction, worker invocations, stale-boundary negative check, Spec generation, Execution Plan generation, and Execution.
- `docs/runbooks/codex-remote-worker-runtime.md` documents the current same-host remote worker and Superpowers dogfood operator path.

The remaining problem is that the current dogfood script still behaves too much like a scripted two-round fixture. It calls `runBoundaryBrainstormingRound(1)`, answers one question, calls `runBoundaryBrainstormingRound(2)`, and then treats summary proposal as the expected next state. That is not the Superpowers brainstorming contract.

## Product Contract

### Boundary Brainstorming Is Codex-Led

Boundary Brainstorming must follow the `superpowers:brainstorming` pattern. Codex AI leads the clarification process. The Leader answers, corrects, rejects, requests changes, and approves, but the product must not hardcode that a specific numbered round produces a specific artifact.

Each AI turn receives:

- source object typed ref and revision;
- Development Plan and Development Plan Item revision;
- Leader and delegate snapshot;
- context manifest;
- complete Boundary transcript so far;
- existing questions, answers, decisions, and summary revisions;
- the triggering Leader input or system event.

Each AI turn may produce any combination of:

- new focused questions;
- follow-up questions;
- risk, assumption, repository-boundary, or validation challenges;
- AI-proposed decisions;
- a Boundary Summary revision candidate;
- an explanation that the boundary is not yet ready for summary or Spec generation.

Leader actions may:

- answer one or more questions;
- add context without answering a specific question;
- accept, reject, or supersede AI-proposed decisions;
- request another clarification turn;
- request changes to a summary candidate;
- approve the latest non-stale summary candidate.

The product status machine owns persistence, authorization, stale detection, and gate enforcement. It does not decide that "round 2 means summary".

### Round-Scoped App-Server Jobs

Every AI turn in this pass must run through a real Dockerized Codex app-server job. The worker must materialize the selected centralized runtime profile and credential binding into a fresh per-task `CODEX_HOME`, run the AI turn, persist public-safe turn evidence, and clean up the task directory/container.

The app-server process must not be held open while the product waits for a human Leader response. Human wait states are represented by persisted Boundary session state. The next AI turn starts a new app-server job with the canonical transcript.

### Approved Summary Gate

Spec generation is unlocked only when all of these are true:

- the Boundary session status is approved;
- the approved Boundary Summary revision is the latest approved revision for the session;
- the summary revision was produced from the latest relevant Boundary round;
- the summary revision references the current Development Plan Item revision;
- no newer Leader answer, Leader revision request, AI turn, or item revision has made the summary stale;
- the approval actor is the stored Leader or authorized delegate.

Execution Plan generation must similarly depend on the approved current Spec revision. Execution must depend on the approved current Execution Plan revision.

## Dogfood Flow

Add or replace the current strict driver with a command such as:

```bash
pnpm dogfood:codex-runtime:real
```

The exact package script name may be finalized in the implementation plan, but the name must be checked against `package.json` and the runbook before commit.

The command must run in same-host strict remote mode:

- `FORGELOOP_CODEX_NO_SHARED_FILESYSTEM=1`;
- generation worker capability uses remote-outbound control-plane polling;
- run-execution worker capability uses remote-outbound control-plane polling;
- Codex config/auth are selected from centralized runtime profile and credential binding records;
- worker environment is scrubbed of `CODEX_HOME`, `FORGELOOP_CODEX_HOME`, `FORGELOOP_CODEX_CONFIG_TOML_PATH`, `FORGELOOP_CODEX_AUTH_JSON_PATH`, and shared repo root allowances;
- each Codex AI turn uses Dockerized app-server, not `codex exec` or CLI fallback.

The command performs this logical flow:

1. Start from a clean isolated dogfood worktree based on `main`.
2. Import or select centralized Codex runtime profile and credential bindings. Local `~/.codex/config.toml` and `~/.codex/auth.json` may be used only by the import step on the setup host.
3. Smoke a generation worker and a no-shared-filesystem run-execution worker.
4. Create or select a SourceObject, Development Plan, and Development Plan Item.
5. Start a Boundary Brainstorming session with a Leader snapshot.
6. Schedule a Codex app-server AI turn.
7. Persist whatever the AI produces. The dogfood driver must inspect the response state instead of assuming a fixed round output.
8. Provide scripted Leader responses that exercise a real multi-turn path.
9. Continue AI turns until a summary candidate is produced, within bounded max-turn and timeout limits.
10. Request changes to at least one summary candidate, then schedule another AI turn.
11. Approve the latest non-stale summary candidate.
12. Mutate the Development Plan Item and prove stale summary cannot unlock Spec generation.
13. Rebase/restart Boundary Brainstorming against the current item revision.
14. Approve a current non-stale Boundary Summary revision.
15. Generate and approve a Spec revision through app-server-backed generation.
16. Generate and approve an Execution Plan revision through app-server-backed generation.
17. Start Execution from the approved Execution Plan revision.
18. Run execution in no-shared-filesystem mode and make a docs-only mutation in the isolated dogfood worktree.
19. Write a public-safe evidence report.

The driver must prove at least one AI follow-up path and at least one summary request-change path. It may use deterministic scripted Leader answers, but it must not stub the Codex AI output or bypass runtime jobs.

## Dogfood Driver Semantics

The driver should operate on product states, not round numbers. It needs a loop similar to:

```text
while session is not approved:
  if status is ai_turn_running:
    run generation worker until current AI turn terminalizes
  if status is waiting_for_leader:
    answer open questions or provide scripted Leader context
  if status is summary_proposed:
    if request-change path not yet covered:
      request changes and continue
    else:
      approve latest non-stale summary
  if max turns or timeout reached:
    write BLOCKED report
```

The driver must record evidence that it did not assume a fixed two-round flow:

- total Boundary AI turn count;
- whether at least one AI turn produced a follow-up question after a Leader answer;
- whether at least one summary candidate was rejected or changed before approval;
- latest approved summary revision id;
- stale summary negative-check result.

## Blocker Fix Policy

This slice may fix only blockers that prevent the real dogfood pass from reaching a truthful PASS or BLOCKED result.

Allowed blocker categories:

- Codex app-server 0.132.0 schema, event, thread, or turn drift in the ForgeLoop adapter;
- centralized runtime profile/config/auth import, binding, digest, or materialization issues;
- no-shared-filesystem worker isolation bugs or false positives;
- Codex-led Boundary AI turn scheduling, result ingestion, transcript persistence, request-change, approval, or stale-gate bugs;
- Spec, Execution Plan, or Execution generation gates that fail to bind to approved current upstream revisions;
- workspace bundle, mounted workspace digest, changed-file allowlist, or docs-only mutation safety issues;
- public-safe report redaction issues;
- operator command/runbook drift for commands required by this pass.

Explicit non-goals:

- dual-machine production deployment UX;
- UI management pages;
- external secret manager;
- production credential rotation;
- long-lived app-server sessions across human wait states;
- worker marketplace or generalized scheduling platform;
- redesigning the Superpowers product flow;
- broad internal renames of runtime-only objects such as run sessions or execution packages when they remain internal evidence.

If the blocker is external to this repository, the command must write a public-safe `BLOCKED` report instead of manufacturing success. External blockers include Docker daemon unavailable, pinned image unavailable, invalid or exhausted API key, unavailable network/proxy, or control-plane process startup failure that cannot be fixed in this slice.

## Evidence Report

The pass writes:

```text
docs/superpowers/reports/codex-runtime-real-dogfood-pass.md
```

The report must include only public-safe evidence:

- status: `PASS` or `BLOCKED`;
- package script command;
- Codex app-server detected capability/schema evidence, redacted to version/digest level;
- runtime profile revision digests;
- credential binding version digests;
- worker mode and no-shared-filesystem flag;
- Boundary session id;
- AI turn count;
- follow-up path covered flag;
- summary request-change path covered flag;
- approved Boundary Summary revision id;
- stale summary negative-check result;
- approved Spec revision id;
- approved Execution Plan revision id;
- Execution id;
- workspace bundle digest;
- mounted task workspace digest;
- changed files;
- cleanup status.

The report must not include:

- API keys;
- raw `auth.json`;
- raw `config.toml`;
- host `~/.codex` path;
- raw localhost/control-plane/app-server endpoints;
- container ids;
- absolute temp paths;
- other active worktree paths;
- full environment dumps.

The report writer must fail closed when unsafe fragments are detected.

## Verification

Required verification for the implementation plan:

- focused tests for any touched contracts, API controllers/services, runtime adapters, worker launch/materialization code, and dogfood driver logic;
- stale Boundary Summary negative tests;
- no-shared-filesystem env scrub tests;
- public-safe report redaction tests;
- app-server schema/capability adapter tests when adapter code changes;
- `pnpm check:codex-runtime-superpowers-no-baggage`;
- `pnpm check:runbook-scripts`;
- `pnpm build`;
- `git diff --check`;
- the real dogfood command, or a `BLOCKED` report with a concrete public-safe blocker code if an external dependency prevents execution.

If product contract or shared API schema changes, also run the relevant contract/API suites. If web UI files are not touched, browser/UI verification is not required for this slice.

## Acceptance Criteria

The slice is complete when:

- a committed spec and implementation plan describe the real dogfood pass;
- the dogfood driver no longer assumes fixed Boundary Brainstorming round numbers;
- real Codex app-server jobs drive Boundary AI turns, Spec generation, Execution Plan generation, and Execution;
- worker runtime does not read worker-local `~/.codex` or shared filesystem config/auth in strict mode;
- centralized profile/auth materialization is evidenced by digest-level records;
- stale Boundary Summary cannot unlock Spec generation;
- a summary request-change path and AI follow-up path are both evidenced;
- Execution produces a docs-only mutation in an isolated dogfood worktree;
- report output is public-safe and fail-closed;
- all required verification commands pass, or the remaining failure is an external blocker captured in the report.

## Open Implementation Notes

- The implementation plan must inspect the current API routes before choosing final endpoint names. This spec intentionally describes product semantics rather than freezing route spelling beyond existing public concepts.
- The plan must keep changes scoped to Codex runtime, Boundary Brainstorming product gates, dogfood scripts, tests, runbook command drift, and evidence report safety.
- The plan must avoid touching unrelated worktrees and must stage only files from this slice.
