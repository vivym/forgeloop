> Superseded historical migration note: this document mentions the old subsystem name for audit history only. Current commands, routes, files, and product docs use delivery terminology.

# P0 Dogfood Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ForgeLoop ready for repeatable remote CI, durable local verification, browser walkthroughs, and the first three real P0 dogfood Work Items.

**Architecture:** Keep this as a readiness layer around the current P0 product slice. Add CI and operator-facing docs/runbooks without expanding the P0 product boundary into Release or Incident yet.

**Tech Stack:** GitHub Actions, pnpm, Node.js 22, Docker Compose, Drizzle, Vitest, Vite, Playwright.

---

## Task 1: Remote CI Gate

**Files:**
- Create: `.github/workflows/ci.yml`

- [x] Add a GitHub Actions workflow for pull requests and pushes to `main`.
- [x] Install dependencies with `pnpm install --frozen-lockfile`.
- [x] Run `pnpm test` and `pnpm build`.
- [x] Validate the workflow syntax by inspecting the YAML and running local test/build.

## Task 2: Local Environment Template

**Files:**
- Create: `.env.example`
- Modify: `README.md`

- [x] Add durable-mode, API, web, dogfood, and dev auth environment defaults.
- [x] Link the template from README local setup.
- [x] Keep secrets as placeholders only.

## Task 3: Dogfood Work Item Runbook

**Files:**
- Create: `docs/dogfood/p0-dogfood-work-items.md`

- [x] Define the three P0 success-criteria Work Items: one feature, one bugfix, one test/refactor.
- [x] Specify expected executor, review path, evidence, and acceptance criteria for each item.
- [x] Include the `changes_requested -> rerun -> approve` exercise.
- [x] Keep P1 Release/Trace/Retrospective decisions deferred until this dogfood batch is complete.

## Task 4: Durable and Browser Verification

**Files:**
- Modify: `docs/superpowers/reports/p0-delivery-loop-verification.md`

- [x] Start local Postgres/Redis/Temporal with Docker Compose.
- [x] Run `pnpm db:push`.
- [x] Run `pnpm dogfood:p0:durable`.
- [x] Run the browser Run Console E2E test.
- [x] Update the verification report with fresh durable/browser evidence and any residual gaps.

## Task 5: Final Verification and Delivery

- [x] Run `git diff --check`.
- [x] Run `pnpm test`.
- [x] Run `pnpm build`.
- [ ] Commit the readiness work.
