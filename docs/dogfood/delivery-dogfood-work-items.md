# Delivery Dogfood Work Items

This runbook defines the first three real ForgeLoop Delivery dogfood Work Items. The goal is to validate the product loop, not to maximize feature volume.

Run the batch with:

```bash
pnpm dogfood:delivery:work-items
```

The script writes the latest completion evidence to `docs/superpowers/reports/delivery-dogfood-work-items-completion.md`.
By default the command stays deterministic and runs all three Work Items with `executor_type: mock` and `workflow_only=true`.
Set `FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1` to opt in to strict local Codex acceptance.

## Batch Acceptance

The batch is complete only when all three Work Items have:

- An approved SpecRevision.
- An approved PlanRevision.
- One or more Execution Packages.
- At least one RunSession result.
- At least one Review Packet.
- A human review decision.
- Timeline evidence containing state transitions, decisions, run evidence, and artifacts.

The batch must include:

- At least two Work Items executed with `executor_type: local_codex`.
- At least one Work Item executed with `executor_type: mock` and `workflow_only=true`.
- At least one flow that exercises `changes_requested -> rerun -> approve`.
- A final written decision on whether P1 should prioritize Release, Trace/Evidence Plane, or Retrospective/Learning Loop.

Default mode explicitly reports `Strict local_codex acceptance: disabled`; that deterministic run validates the workflow path but does not complete strict runbook acceptance. Strict mode is enabled only when `FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1`.

Strict mode is complete only when at least two Work Items satisfy the Work Item-level Strict Success Contract:

- Every Execution Package on the Work Item is complete according to `deriveWorkItemCompletion(...).done`.
- The current RunSession is `executor_type: local_codex`, `workflow_only=false`, and `status: succeeded`.
- A Review Packet for the same Execution Package and RunSession is `status: completed` and `decision: approved`.
- The current RunSession includes every `required_artifact_kinds` entry.

Approved Review Packets for `mock` or `workflow_only=true` runs do not count toward strict acceptance. A successful local Codex RunSession without a completed approved Review Packet for the same package and run does not count.

## Strict Dirty Source Allowlist

Strict mode refuses unexpected source checkout dirtiness before starting real local Codex. The dogfood-only allowed dirty entries are:

- `docs/superpowers/reports/delivery-dogfood-work-items-completion.md`
- `.superpowers/**`

This allowlist is mirrored by the implementation constant `STRICT_WORK_ITEMS_DOGFOOD_DIRTY_ALLOWLIST`, which reuses `STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST`. The report records `allowed_dirty_entries`, `blocked_dirty_entries`, and `dirty_allowlist_source` when strict preflight fails or needs to explain dirty-source handling.

The allowlist must not include application, package, script, spec, plan, or source files that real local Codex is expected to mutate inside `.worktrees/<run-session-id>`.

## Work Item 1: Feature - Remote CI Gate

**Type:** Feature
**Priority:** P0
**Recommended executor:** `local_codex`
**Goal:** Add a GitHub Actions gate that installs dependencies, runs tests, and builds all packages on push and pull request.

**Suggested Spec scope:**

- Create a CI workflow for `main` pushes and pull requests.
- Use the repository `packageManager` through Corepack.
- Run `pnpm install --frozen-lockfile`, `pnpm test`, and `pnpm build`.
- Keep permissions read-only unless a future workflow needs write access.

**Suggested Plan checkpoints:**

- Add `.github/workflows/ci.yml`.
- Verify the workflow is syntactically valid YAML.
- Run local `pnpm test` and `pnpm build`.

**Review focus:**

- CI must not require local-only services.
- CI must not run real local Codex dogfood.
- CI should fail on test or TypeScript regressions.

**Acceptance evidence:**

- CI workflow artifact in git.
- Local test/build output.
- Review Packet approved by a human.

## Work Item 2: Bugfix - Durable Verification Gaps

**Type:** Bugfix
**Priority:** P0
**Recommended executor:** `local_codex`
**Goal:** Close the documented durable-mode verification gaps in the delivery verification report.

**Suggested Spec scope:**

- Start local durable dependencies through Docker Compose.
- Run Drizzle schema push against Postgres.
- Run durable dogfood with `pnpm dogfood:delivery:durable`.
- Record durable pass/fail evidence in the verification report.

**Suggested Plan checkpoints:**

- Confirm Docker services are healthy.
- Run `pnpm db:push`.
- Run `pnpm dogfood:delivery:durable`.
- Update `docs/superpowers/reports/delivery-loop-verification.md`.

**Review focus:**

- The dogfood script must not drop a user-provided database.
- Durable restart recovery must be clearly claimed only when actually verified.
- Authenticated durable API/SSE gaps must remain explicit if not closed.

**Acceptance evidence:**

- Durable dogfood PASS result.
- Updated verification report with exact command evidence.
- If durable verification cannot run, a concrete blocker with command output.

## Work Item 3: Test/Refactor - Browser Run Console Walkthrough

**Type:** Test / Refactor
**Priority:** P0
**Recommended executor:** `mock`
**Required path:** Exercise `changes_requested -> rerun -> approve`.
**Goal:** Validate the browser workbench as an operator experience, especially Run Console backfill, live output, user input, cancel/resume, and review decisions.

**Suggested Spec scope:**

- Run the web app against the control-plane API.
- Execute the browser Run Console E2E path.
- Capture any visual/text-overflow concerns as follow-up items.
- Keep this Work Item `workflow_only=true` so it cannot be mistaken for real code evidence.

**Suggested Plan checkpoints:**

- Start API and web services.
- Run `pnpm e2e:run-console`.
- Inspect desktop and narrow viewport screenshots or Playwright traces when available.
- Record browser verification status in the delivery verification report.

**Review focus:**

- The UI should expose prior events before appending new SSE events.
- User input must persist as a command and visible event.
- Review Packet handoff must be understandable without reading logs.

**Acceptance evidence:**

- Browser E2E PASS result.
- Verification report updated with browser status.
- One review cycle where the first Review Packet receives `changes_requested`, the rerun creates a new RunSession, and the final Review Packet is approved.

## P1 Decision Rule

After all three Work Items are complete, choose the next product surface by observed pain:

- Choose **Release** if the main gap is "approved work has no delivery grouping or rollout decision."
- Choose **Trace/Evidence Plane** if the main gap is "reviewers cannot reconstruct cause and effect quickly."
- Choose **Retrospective/Learning Loop** if the main gap is "the same mistakes repeat and are not codified into future execution."

Do not start P1 productization until the three Delivery dogfood Work Items have been reviewed.

## Final P1 Decision Summary

Decision: prioritize **Trace / Evidence Plane** for P1.

Rationale: Delivery dogfood made the product loop visible, but the reviewer experience still requires too much manual reconstruction across RunSessions, reruns, artifacts, status history, and Review Packets. The next product surface should make cause and effect readable without exposing raw logs or internal payloads.

Release and Retrospective remain important follow-ups, but Trace / Evidence Plane is the smallest next step that strengthens review confidence and gives later Release and Learning workflows a reliable evidence spine.
