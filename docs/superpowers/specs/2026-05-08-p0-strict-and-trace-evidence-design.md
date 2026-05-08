# P0 Strict Dogfood And Trace Evidence Plane Design

## Overview

This design completes the remaining P0 dogfood acceptance gap and defines the first P1 product surface. It is a program spec with three implementation phases:

1. P0 strict `local_codex` Work Item acceptance.
2. P1 decision record selecting Trace / Evidence Plane.
3. Reviewer-first Evidence Chain MVP.

The work intentionally stays below full Trace Plane productization. P0 must prove that ForgeLoop can drive real Codex execution through Work Items when explicitly enabled. P1 should then make reviewer evidence reconstruction faster and more trustworthy.

## Source Context

- P0 runbook: `docs/dogfood/p0-dogfood-work-items.md`
- P0 completion report: `docs/superpowers/reports/p0-dogfood-work-items-completion.md`
- P0 verification report: `docs/superpowers/reports/p0-delivery-loop-verification.md`
- Trace design reference: `docs/architecture-design/v0/trace-evidence-plane.md`
- Long-running execution design: `docs/superpowers/specs/2026-05-06-codex-long-running-execution-design.md`

## Problem

The current P0 dogfood Work Items report validates the product workflow with three `mock` / `workflow_only=true` packages. That proves the Work Item -> Spec -> Plan -> Execution Package -> RunSession -> Review Packet -> human decision loop works, including `changes_requested -> rerun -> approve`.

The runbook's Batch Acceptance is stricter. It also requires at least two Work Items executed with `executor_type: local_codex`. The current report therefore proves product workflow completion, but not the full strict runbook acceptance.

The same dogfood cycle exposed the next product pain: reviewers can see timelines and artifacts, but reconstructing cause and effect still requires reading multiple object views and remembering how RunSession, ReviewPacket, Artifact, Decision, rerun, and status history records fit together. That points to Trace / Evidence Plane as the next P1 surface.

## Goals

- Keep the default Work Item dogfood command fast and deterministic.
- Add an explicit strict mode that requires at least two real `local_codex` Work Items and one mock rerun path.
- Make strict-mode failures produce concrete blocker evidence instead of ambiguous success reports.
- Record the P1 decision in both the P0 runbook and a standalone decision document.
- Add a reviewer-first Evidence Chain MVP that answers: "Can I trust this Review Packet, and what evidence supports it?"
- Preserve existing raw log redaction behavior.

## Non-Goals

- Do not run real Codex in CI by default.
- Do not make TraceEvent the only truth source in this phase.
- Do not implement full SaaS enrollment, multi-tenant trace ingestion, actor identity governance, workspace state, code provenance, or incident replay.
- Do not add a new graph visualization or separate trace product page.
- Do not expose raw Codex logs, `raw_ref`, or internal-only payloads through API or UI.

## Phase 1: P0 Strict `local_codex` Acceptance

### Command Behavior

`pnpm dogfood:p0:work-items` remains the default command. Its behavior depends on `FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD`.

When the environment variable is unset or not `1`:

- Create the three P0 Work Items with `mock` / `workflow_only=true`.
- Preserve the third Work Item's `changes_requested -> rerun -> approve` flow.
- Write a report that explicitly states:
  - `Strict local_codex acceptance: disabled`
  - strict runbook acceptance is not complete in this run
  - real local Codex acceptance is available through the opt-in mode
- Exit `0` if the deterministic workflow dogfood passes.

When `FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1`:

- Execute at least two Work Items with `executor_type: local_codex` and `workflow_only=false`.
- Keep at least one Work Item with `executor_type: mock` and `workflow_only=true`.
- Preserve one `changes_requested -> rerun -> approve` path. The path may stay on the mock Browser Run Console item to avoid mixing rerun review semantics with real code mutation risk.
- Require at least two successful `local_codex` RunSessions before reporting strict success.
- Exit `1` if fewer than two `local_codex` Work Items reach approved Review Packet completion.

### Recommended Work Item Mapping

- Remote CI Gate: `local_codex`, `workflow_only=false`.
- Durable Verification Gaps: `local_codex`, `workflow_only=false`.
- Browser Run Console Walkthrough: `mock`, `workflow_only=true`, exercises `changes_requested -> rerun -> approve`.

The local Codex items must be bounded by each Execution Package's `allowed_paths` and `forbidden_paths`. They must use the existing long-running execution boundary: `.worktrees/<run-session-id>` under the configured source repository.

### Strict Preconditions

Strict mode must check and report blockers for:

- `codex` command availability.
- Authenticated local Codex runtime.
- dangerous/yolo execution mode confirmation through the existing local Codex path.
- source checkout cleanliness, unless an explicitly documented dogfood-only dirty allowlist applies.
- durable repository availability when `FORGELOOP_DATABASE_URL` is set.
- ability to create isolated run worktrees.

### Report Requirements

`docs/superpowers/reports/p0-dogfood-work-items-completion.md` must include:

- strict local Codex status: `disabled`, `passed`, or `failed`.
- per Work Item executor type and `workflow_only` value.
- per Work Item run session ids and review packet ids.
- blocker section when strict mode fails.
- a final statement that does not claim strict batch acceptance unless at least two `local_codex` Work Items completed.

## Phase 2: P1 Decision Record

The P1 decision is Trace / Evidence Plane.

Write the decision in two places:

- Add a short final decision summary to `docs/dogfood/p0-dogfood-work-items.md`.
- Create `docs/superpowers/decisions/2026-05-08-p1-trace-evidence-plane.md`.

The standalone decision document must include:

- decision: prioritize Trace / Evidence Plane for P1.
- rejected alternatives: Release and Retrospective / Learning Loop.
- dogfood evidence motivating the decision.
- explicit scope for the MVP.
- risks and follow-up candidates.

Rationale:

- Release depends on trustworthy evidence; doing Release first would package decisions whose support chain is still hard to reconstruct.
- Retrospective / Learning Loop depends on high-quality trace data; doing it first would force weak inputs into learning assets.
- Reviewer evidence reconstruction is the closest and highest-leverage pain from P0 dogfood.

## Phase 3: Reviewer-First Evidence Chain MVP

### User

The first user is Reviewer. The MVP should make it fast to decide whether a Review Packet is trustworthy.

The reviewer should be able to answer:

- Which RunSessions support this Review Packet?
- Which checks, artifacts, and decisions support the final state?
- Was there a `changes_requested` decision?
- Did a rerun replace or supersede earlier evidence?
- Are required artifacts missing?
- Was any evidence redacted because it is internal/raw?

### Data Model

Add a minimal trace/evidence subdomain without replacing existing evidence tables.

Recommended tables:

- `trace_events`
  - `id`
  - `source`
  - `event_type`
  - `summary`
  - `payload`
  - `visibility`
  - `created_at`
- `trace_links`
  - `id`
  - `trace_event_id`
  - `object_type`
  - `object_id`
  - `relationship`
  - `created_at`
- `trace_artifact_refs` or equivalent lightweight blob reference table
  - `id`
  - `trace_event_id`
  - `artifact_id`
  - `ref_kind`
  - `redacted`
  - `created_at`

The first implementation may omit large blob storage and store only controlled references to existing artifacts. It must not expose raw logs or `raw_ref`.

### Projection Boundary

The MVP can combine two mechanisms:

1. Synchronous trace writes for new data when API, workflow, or worker paths create `RunEvent`, `ObjectEvent`, `StatusHistory`, `Artifact`, `Decision`, or `ReviewPacket`.
2. A read-time helper that builds an Evidence Chain from existing P0 tables.

The read-time helper is important because the current database already has useful evidence tables. The UI should not depend on every writer being migrated before it can show value.

Later phases can replace read-time reconstruction with an explicit projector and backfill job.

### Evidence Chain API

Add:

```text
GET /work-items/:workItemId/evidence-chain
```

The endpoint returns a reviewer-oriented view, not raw trace rows.

Shape:

```ts
type EvidenceChainResponse = {
  work_item_id: string;
  generated_at: string;
  summary: {
    total_items: number;
    run_count: number;
    review_packet_count: number;
    decision_count: number;
    artifact_count: number;
    risk_flags: string[];
  };
  items: EvidenceChainItem[];
};
```

`EvidenceChainItem` should include:

- `id`
- `source`: `run_event | status_history | artifact | decision | review_packet | object_event`
- `subject`: object type and id
- `summary`
- `created_at`
- `visibility`
- `links`: object references for run sessions, review packets, artifacts, packages, and decisions
- `risk_flags`
- `redacted` when applicable

Existing `GET /work-items/:workItemId/cockpit` may include a lightweight `evidence_chain_summary`, but it should not embed the full chain.

### UI

Add an Evidence Chain section to the existing Web Workbench near cockpit/timeline, not as a separate product route.

UI requirements:

- Show summary counts for runs, review packets, decisions, artifacts, and risk flags.
- Show a linear timeline/list ordered by `created_at`.
- Display source, summary, object id, and key status/decision state.
- Make Review Packet items show `none`, `changes_requested`, or `approved`.
- Make Run items show status and whether evidence was rerun or superseded.
- Show only public artifacts.
- Never render raw log refs, `raw_ref`, or internal-only payload.

The first UI can use simple grouping or collapsible source sections. Avoid graph visualization until the linear chain proves insufficient.

## Error Handling

### P0 Strict Mode

- Strict disabled: exit `0` if deterministic dogfood passes, but report strict acceptance as disabled.
- Codex unavailable or unauthenticated: exit `1` in strict mode and write blocker details.
- source repo dirty: exit `1` in strict mode unless an explicit dogfood allowlist applies.
- local Codex run succeeds but Review Packet is not approved: exit `1`.
- one of two required local Codex Work Items fails: exit `1` and list the failed Work Item, RunSession, and diagnostic notes.

### Evidence Chain

- missing Work Item: return `404`.
- no evidence: return `200` with empty items and `risk_flags: ["no_evidence"]`.
- internal/raw evidence: redact or omit raw details and mark `redacted`.
- trace write failure: must not corrupt the primary business transaction in MVP; the read-time helper should still reconstruct from existing P0 tables.

## Testing Strategy

### P0 Strict Tests

- Default mode report includes `Strict local_codex acceptance: disabled`.
- Strict mode fails when fewer than two `local_codex` Work Items complete.
- Strict mode passes when two `local_codex` Work Items complete and one mock rerun path completes.
- Strict failure writes blocker information.
- CI must not run real Codex by default.

Use fake/stubbed local Codex execution in automated tests. Real Codex remains opt-in dogfood.

### Evidence Chain Tests

- Schema tests cover new trace tables.
- Repository tests cover saving/listing trace events and links.
- API tests prove `GET /work-items/:id/evidence-chain` can reconstruct:
  - run events
  - status histories
  - artifacts
  - decisions
  - review packets
  - `changes_requested -> rerun -> approve`
- API tests prove raw logs and `raw_ref` do not appear.
- Web tests cover Evidence Chain summary and item rendering.
- Smoke/dogfood report includes trace/evidence chain coverage.

## Acceptance Criteria

- `pnpm test` passes.
- `pnpm build` passes.
- Default `pnpm dogfood:p0:work-items` reports strict local Codex acceptance as disabled, not passed.
- `FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 pnpm dogfood:p0:work-items` either:
  - passes with at least two approved `local_codex` Work Items and one mock rerun path, or
  - fails with concrete blocker evidence.
- `docs/dogfood/p0-dogfood-work-items.md` records the P1 decision summary.
- `docs/superpowers/decisions/2026-05-08-p1-trace-evidence-plane.md` records the decision and rationale.
- `GET /work-items/:workItemId/evidence-chain` returns a reviewer-readable chain.
- Web Workbench renders Evidence Chain without raw/internal evidence leakage.

## Implementation Notes

- Keep changes scoped to existing P0 module, DB repository, Web Workbench, dogfood scripts, and docs.
- Prefer small helper modules for Evidence Chain construction instead of growing `P0Service`.
- Keep the read model stable even if trace write coverage is initially partial.
- Commit implementation by phase so P0 strict dogfood can be validated independently from Trace/Evidence MVP.
