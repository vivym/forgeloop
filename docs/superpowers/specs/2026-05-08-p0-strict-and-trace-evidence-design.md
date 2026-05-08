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
- Require approved Review Packet completion for at least two `local_codex` Work Items before reporting strict success.
- Exit `1` if fewer than two `local_codex` Work Items reach approved Review Packet completion.

### Strict Success Contract

Strict batch acceptance is a Work Item completion contract, not a RunSession-only contract.

A `local_codex` Work Item counts toward strict success only when all of these are true:

- all Execution Packages for the Work Item satisfy `deriveWorkItemCompletion(...).done` after that helper delegates required artifact presence to the Required Artifact Contract below;
- at least one current Execution Package for the Work Item has `last_run_session_id` set;
- that current RunSession was created with `executor_type: local_codex` and `run_spec.workflow_only=false`;
- that current RunSession reached `status: succeeded`;
- a Review Packet for that same Execution Package and RunSession reached `status: completed` with `decision: approved`;
- that current RunSession satisfies the package's `required_artifact_kinds`;
- the report lists the Work Item id, Execution Package id, RunSession id, Review Packet id, executor type, and `workflow_only` value.

A successful `local_codex` RunSession without an approved Review Packet is not strict success. An approved Review Packet for a mock or `workflow_only=true` run is not strict success.

The P0 dogfood command should continue to create one Execution Package per generated Work Item. If a counted Work Item unexpectedly has multiple packages, it may count only if every package is complete and the current package used for the strict count is the `local_codex` package described above. Partial package completion must not count.

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

Strict preflight must produce this report shape:

```ts
type StrictPreflightBlockerCode =
  | "missing_codex_command"
  | "codex_not_authenticated"
  | "dangerous_mode_unconfirmed"
  | "source_dirty_blocked"
  | "durable_repo_unavailable"
  | "worktree_create_failed";

type StrictPreflightResult = {
  ok: boolean;
  blockers: Array<{
    code: StrictPreflightBlockerCode;
    message: string;
    details?: Record<string, unknown>;
  }>;
};
```

Strict mode exits `1` when any blocker is present. The completion report must include each blocker code, message, and relevant details.

### Dirty Source Allowlist

Strict mode must fail on unexpected source checkout dirtiness before starting real Codex. The only allowed dirty entries are dogfood harness outputs documented in a `Strict Dirty Source Allowlist` subsection of `docs/dogfood/p0-dogfood-work-items.md` and mirrored by the dogfood command implementation.

Initial allowed patterns:

- `docs/superpowers/reports/p0-dogfood-work-items-completion.md`
- `.superpowers/**`

The allowlist is dogfood-only. It must not allow `apps/**`, `packages/**`, `scripts/**`, `docs/superpowers/specs/**`, `docs/superpowers/plans/**`, or source files that Codex is expected to mutate inside the isolated `.worktrees/<run-session-id>` run workspace.

The strict report must split checkout dirtiness into:

- `allowed_dirty_entries`: paths that matched the allowlist;
- `blocked_dirty_entries`: paths that caused strict preflight failure;
- `dirty_allowlist_source`: the runbook section or implementation constant used for the decision.

`.worktrees/**` should be ignored by git and should not appear as a source checkout dirty entry.

### Report Requirements

`docs/superpowers/reports/p0-dogfood-work-items-completion.md` must include:

- strict local Codex status: `disabled`, `passed`, or `failed`.
- per Work Item executor type and `workflow_only` value.
- per Work Item run session ids and review packet ids.
- blocker section when strict mode fails.
- a final statement that does not claim strict batch acceptance unless at least two `local_codex` Work Items meet the Strict Success Contract.

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

### Evidence Chain Contract

The Evidence Chain MVP is centered on a Review Packet. A Work Item level query exists for navigation, but the trust question is always answered for either an explicitly selected Review Packet or the current Review Packet set.

Supported endpoint:

```text
GET /work-items/:workItemId/evidence-chain
GET /work-items/:workItemId/evidence-chain?review_packet_id=:reviewPacketId
```

Selection rules:

- When `review_packet_id` is present, the endpoint must verify that the Review Packet belongs to the Work Item through its Execution Package. The response is scoped to that Review Packet, its RunSession, its Execution Package, predecessor/superseded run relationships, decisions, artifacts, and relevant lifecycle events.
- When `review_packet_id` is absent, the endpoint selects the current non-archived Review Packet for each Execution Package in the Work Item. Current means the packet tied to `ExecutionPackage.last_run_session_id`; if that pointer is absent, use the latest non-archived packet by `created_at` and mark `projection.partial=true`.
- The response must identify the selection with `focus.selection: "explicit" | "current"` and `focus.review_packet_ids`.
- The response must not use timestamp ordering alone to decide whether one run replaced another. Supersession comes from the persisted relationships defined below.

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

### Trace Link Relationships

`trace_links.relationship` must be constrained to this initial enum:

- `belongs_to`: event belongs to a Work Item, Execution Package, RunSession, Review Packet, Artifact, Decision, or required check.
- `generated_by`: object was generated by the linked RunSession or workflow step.
- `supports`: evidence supports the linked Review Packet or decision.
- `supersedes`: the new run or packet supersedes the linked previous run or packet.
- `replaces`: the new Review Packet replaces the linked previous Review Packet for reviewer decision-making.
- `redacted_from`: public trace item summarizes or stands in for an omitted internal/raw source.

Implementation must reject or ignore unknown relationship values. Tests must cover the enum so future code does not invent relationship strings ad hoc.

Relationship direction is event-to-object: the row says how the `trace_event_id` relates to the target `object_type` / `object_id`. For replacement events, `supersedes` and `replaces` point at the previous object being superseded or replaced; the new object id must also appear in the event payload and as a `generated_by` or `belongs_to` link.

### Supersession Semantics

Rerun replacement is a persisted relationship, not a timeline inference.

When `rerun_package` or `force_rerun_package` creates a new RunSession, the system must persist stable links that identify:

- `new_run_session_id`
- `previous_run_session_id`
- `triggering_review_packet_id` when provided by the rerun request
- the new Review Packet id once it is generated
- the previous Review Packet id when the rerun replaces reviewer evidence

The MVP should express these links with `trace_events` and `trace_links` using `supersedes` and `replaces`. If the implementation adds a small first-class run replacement table instead, the Evidence Chain read model must still project the same fields.

Concrete trace event contract:

```ts
type RunReplacementRecordedPayload = {
  mode: "rerun_package" | "force_rerun_package";
  execution_package_id: string;
  work_item_id: string;
  new_run_session_id: string;
  previous_run_session_id: string;
  triggering_review_packet_id?: string;
  previous_review_packet_id?: string;
  new_review_packet_id?: string;
};
```

When the rerun is queued, write `run_replacement_recorded` with links:

- `belongs_to` Work Item and Execution Package;
- `generated_by` new RunSession;
- `supersedes` previous RunSession;
- `replaces` previous Review Packet when known;
- `belongs_to` triggering Review Packet when supplied.

When the new Review Packet is generated later, update the replacement event payload with `new_review_packet_id` or write a follow-up replacement event with the same `new_run_session_id` / `previous_run_session_id`. The read model must project a single replacement relationship either way.

UI/API ordering rules:

- current replacement evidence appears before superseded evidence in the Review Packet focus grouping;
- superseded items remain visible as history but carry `risk_flags: ["superseded_run"]` or `["stale_review_packet"]` as applicable;
- if existing historical data lacks persisted replacement links, the endpoint must not infer replacement by timestamp alone. It should mark `projection.partial=true` and add a projection gap.
- unlinked historical reruns remain visible as unlinked history. They must not receive `superseded_run` or `stale_review_packet` based only on timestamps; the response must set `projection.partial=true` and add gap code `missing_supersession_links`.

### Projection Boundary

The MVP can combine two mechanisms:

1. Synchronous trace writes for new data when API, workflow, or worker paths create `RunEvent`, `ObjectEvent`, `StatusHistory`, `Artifact`, `Decision`, or `ReviewPacket`.
2. A read-time helper that builds an Evidence Chain from existing P0 tables.

The read-time helper is important because the current database already has useful evidence tables. The UI should not depend on every writer being migrated before it can show value.

Later phases can replace read-time reconstruction with an explicit projector and backfill job.

MVP boundary:

- Existing records do not need a one-time trace backfill.
- It is valid for `trace_events` to be empty for records created before this implementation, as long as the read-time helper can reconstruct reviewer evidence from current P0 tables.
- New writes in touched API, workflow, and worker paths should emit trace events where the spec already requires them.
- Every Evidence Chain response must include `projection: { source, version, partial, gaps }`, where `source` is `trace_events`, `read_time`, or `mixed`, `version` starts at `1`, `partial` is true when required trace relationships are absent, and `gaps` contains concise machine-readable gap codes.

### Evidence Chain API

Add:

```text
GET /work-items/:workItemId/evidence-chain
GET /work-items/:workItemId/evidence-chain?review_packet_id=:reviewPacketId
```

The endpoint returns a reviewer-oriented view, not raw trace rows.

Shape:

```ts
type EvidenceChainResponse = {
  work_item_id: string;
  generated_at: string;
  focus: {
    selection: "explicit" | "current";
    review_packet_ids: string[];
  };
  projection: {
    source: "trace_events" | "read_time" | "mixed";
    version: 1;
    partial: boolean;
    gaps: EvidenceChainProjectionGapCode[];
  };
  summary: {
    total_items: number;
    run_count: number;
    review_packet_count: number;
    decision_count: number;
    artifact_count: number;
    risk_flags: EvidenceChainRiskFlag[];
    redacted_count: number;
  };
  items: EvidenceChainItem[];
};
```

Summary count semantics:

- `total_items` is exactly `items.length`.
- `run_count`, `review_packet_count`, `decision_count`, and `artifact_count` count distinct domain objects represented in the selected evidence scope, not only visible list rows.
- Redacted artifacts still increment `artifact_count` and `redacted_count`.
- `decision_count` counts persisted `Decision` evidence records. A Review Packet's `decision` field is not counted as a `Decision` unless it is represented by a persisted `Decision` evidence item.
- `redacted_count` counts omitted or synthetic-redacted evidence sources, including artifacts that satisfy required presence but cannot be displayed publicly.

`EvidenceChainItem` must be a strict contract, published with Zod schemas in `packages/contracts/src/api.ts`:

```ts
type EvidenceChainSource =
  | "run_event"
  | "status_history"
  | "artifact"
  | "decision"
  | "review_packet"
  | "object_event"
  | "trace_event";

type EvidenceChainObjectType =
  | "work_item"
  | "execution_package"
  | "run_session"
  | "review_packet"
  | "artifact"
  | "decision"
  | "required_check"
  | "trace_event";

type EvidenceChainRiskFlag =
  | "no_evidence"
  | "missing_required_artifact"
  | "redacted_evidence"
  | "superseded_run"
  | "stale_review_packet"
  | "unapproved_review_packet"
  | "failed_required_check"
  | "changes_requested"
  | "projection_partial";

type EvidenceChainRedactionReason =
  | "internal_event"
  | "raw_ref"
  | "logs_artifact"
  | "raw_metadata_artifact"
  | "local_ref_only"
  | "internal_payload";

type EvidenceChainProjectionGapCode =
  | "missing_supersession_links"
  | "missing_last_run_session"
  | "missing_trace_events"
  | "missing_trace_artifact_refs";

type EvidenceChainObjectRef = {
  object_type: EvidenceChainObjectType;
  object_id: string;
  relationship?: "belongs_to" | "generated_by" | "supports" | "supersedes" | "replaces" | "redacted_from";
};

type EvidenceChainItem = {
  id: string;
  source: EvidenceChainSource;
  subject: EvidenceChainObjectRef;
  summary: string;
  created_at: string;
  visibility: "public";
  links: EvidenceChainObjectRef[];
  risk_flags: EvidenceChainRiskFlag[];
  redacted: boolean;
  details?: {
    decision?: "none" | "approved" | "changes_requested";
    run_status?: string;
    missing_artifact_kinds?: ArtifactKind[];
    required_check_ids?: string[];
    failed_check_ids?: string[];
    redaction_reason?: EvidenceChainRedactionReason;
    replacement?: {
      new_run_session_id?: string;
      previous_run_session_id?: string;
      new_review_packet_id?: string;
      previous_review_packet_id?: string;
    };
    projection_gap_codes?: EvidenceChainProjectionGapCode[];
  };
};
```

Existing `GET /work-items/:workItemId/cockpit` may include a lightweight `evidence_chain_summary`, but it should not embed the full chain.

### Risk Flags

`risk_flags` must use this canonical enum:

- `no_evidence`: the Work Item or selected Review Packet has no reconstructable events, decisions, artifacts, or run evidence.
- `missing_required_artifact`: an Execution Package's `required_artifact_kinds` contains a kind absent from the selected terminal RunSession's evidence refs under the Required Artifact Contract.
- `redacted_evidence`: at least one relevant evidence source was omitted or summarized because it is internal, raw, a log, or contains a `raw_ref`/local-only payload.
- `superseded_run`: a RunSession is linked as superseded by a later rerun.
- `stale_review_packet`: a Review Packet is not tied to the package's current `last_run_session_id` or has been replaced by a later packet.
- `unapproved_review_packet`: a selected/current Review Packet is not `status: completed` with `decision: approved`.
- `failed_required_check`: a required blocking check failed, timed out, or is missing a passing result in the selected RunSession.
- `changes_requested`: the chain includes a completed Review Packet decision of `changes_requested`.
- `projection_partial`: the response was reconstructed without full trace relationships or backfill coverage.

Summary-level flags are the de-duplicated union of item-level flags plus response-level flags. Response-level flags are valid even when no item carries them:

- `no_evidence` when `items` is empty.
- `redacted_evidence` when evidence was omitted or represented only by a synthetic redaction marker.
- `projection_partial` when `projection.partial=true`.

Item-level flags must include enough links/details for the reviewer to find the affected run, review packet, check, or artifact kind.

### Required Artifact Contract

Required artifact checks use `ExecutionPackage.required_artifact_kinds` as the source of truth. Presence and public display are separate concerns.

Presence checks compare required kinds against the selected terminal RunSession's evidence refs:

- `logs` is satisfied by `RunSession.log_refs[].kind`.
- all other required kinds are satisfied by `RunSession.artifacts[].kind`.

This is the single required artifact presence predicate for both strict P0 success and Evidence Chain risk calculation. The implementation must update or route `deriveWorkItemCompletion` through this predicate rather than keeping a separate `RunSession.artifacts`-only check.

For an explicit Review Packet query, the selected RunSession is `ReviewPacket.run_session_id`.

For a current Work Item query, the selected RunSession is `ExecutionPackage.last_run_session_id` for each package. If the pointer is missing, the endpoint may use the Review Packet's `run_session_id`, but it must mark `projection.partial=true` with a gap code.

Missing artifacts produce `missing_required_artifact` with the missing artifact kinds in item details. They also prevent strict P0 success for `local_codex` Work Items.

Required artifacts that are present but not public, such as `logs` or `raw_metadata`, satisfy the presence check but still follow the Public Evidence Redaction contract. The Evidence Chain should add `redacted_evidence` and a redaction marker instead of exposing the raw artifact.

### Public Evidence Redaction

The API uses omit-plus-marker redaction:

- Public Evidence Chain items may include normalized summaries, ids, object links, artifact kind/name/content type/digest, decision summaries, status transitions, and public RunEvents.
- Public Evidence Chain items must not include `raw_ref`, raw logs, `ArtifactRef.local_ref`, raw command output, internal `RunEvent.payload`, or internal-only object payloads.
- Existing `Artifact` rows do not have a visibility column. For MVP, artifact publicness is classified from the artifact ref itself: an artifact is public only when `ref.kind` is not `logs` or `raw_metadata`, the response can describe it without exposing `local_ref`, and no `raw_ref` or raw payload is needed to render it.
- Internal/raw artifacts and events are omitted from `items`. The response increments `summary.redacted_count`, adds `redacted_evidence`, and may include a synthetic public item with `source: "artifact"` or `source: "run_event"`, `redacted: true`, and no raw payload when a reviewer needs to know evidence was withheld.
- The UI renders the redaction marker/count but never links to or expands raw/internal evidence.

### UI

Add an Evidence Chain section to the existing Web Workbench near cockpit/timeline, not as a separate product route.

UI requirements:

- Show summary counts for runs, review packets, decisions, artifacts, and risk flags.
- Show a linear timeline/list ordered by `created_at` within each grouping. The default grouping should show current focus evidence first and superseded history second.
- Display source, summary, object id, and key status/decision state.
- Make Review Packet items show `none`, `changes_requested`, or `approved`.
- Make Run items show status and whether evidence was rerun or superseded.
- Show only public artifact metadata under the Public Evidence Redaction contract.
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
- explicit `review_packet_id` outside the Work Item: return `404`.
- internal/raw evidence: omit raw details, increment `redacted_count`, and mark `redacted_evidence`.
- trace write failure: must not corrupt the primary business transaction in MVP; the read-time helper should still reconstruct from existing P0 tables.

## Testing Strategy

### P0 Strict Tests

- Default mode report includes `Strict local_codex acceptance: disabled`.
- Strict mode fails when fewer than two `local_codex` Work Items meet the Strict Success Contract.
- Strict mode does not count a Work Item when another package on that Work Item is incomplete.
- Strict mode fails when a `local_codex` RunSession succeeds but its Review Packet is not completed and approved.
- Strict mode fails when a `local_codex` approved Review Packet is missing required artifacts.
- Strict mode passes when two `local_codex` Work Items reach approved Review Packet completion with required artifacts and one mock rerun path completes.
- Strict failure writes blocker information.
- Strict preflight tests cover every `StrictPreflightBlockerCode` with stubbed dependencies.
- Strict source cleanliness tests cover allowed and blocked dirty entries.
- CI must not run real Codex by default.

Use fake/stubbed local Codex execution in automated tests. Real Codex remains opt-in dogfood.

### Evidence Chain Tests

- Schema tests cover new trace tables.
- Repository tests cover saving/listing trace events and links.
- Contract tests cover the strict Evidence Chain DTO schemas in `packages/contracts/src/api.ts`.
- API tests prove `GET /work-items/:id/evidence-chain` can reconstruct:
  - run events
  - status histories
  - artifacts
  - decisions
  - review packets
  - `changes_requested -> rerun -> approve`
- API tests cover explicit `review_packet_id` selection and default current Review Packet selection.
- API tests cover canonical `risk_flags`: no evidence, missing required artifact, redacted evidence, superseded/stale evidence, unapproved packet, failed required check, changes requested, and partial projection.
- API tests cover required `logs` artifacts satisfying presence through `RunSession.log_refs` while remaining redacted in public output.
- API tests prove supersession uses persisted relationships rather than timestamp inference.
- API tests cover `run_replacement_recorded` payload/link direction and the follow-up update when `new_review_packet_id` becomes available.
- API tests cover unlinked historical reruns as unlinked history with `projection.partial=true` and `missing_supersession_links`.
- API tests prove raw logs, `raw_ref`, `ArtifactRef.local_ref`, and internal payloads do not appear.
- Schema/repository tests constrain `trace_links.relationship` values.
- Read-model tests cover pre-existing records without trace backfill and include projection metadata.
- Web tests cover Evidence Chain summary and item rendering.
- Web tests cover redacted count/marker rendering without raw evidence links.
- Smoke/dogfood report includes trace/evidence chain coverage.

## Acceptance Criteria

- `pnpm test` passes.
- `pnpm build` passes.
- Default `pnpm dogfood:p0:work-items` reports strict local Codex acceptance as disabled, not passed.
- `FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 pnpm dogfood:p0:work-items` either:
  - passes with at least two `local_codex` Work Items that have succeeded RunSessions, completed/approved Review Packets, and required artifacts, plus one mock rerun path, or
  - fails with concrete blocker evidence.
- `docs/dogfood/p0-dogfood-work-items.md` records the P1 decision summary.
- `docs/dogfood/p0-dogfood-work-items.md` documents the Strict Dirty Source Allowlist used by strict dogfood preflight.
- `docs/superpowers/decisions/2026-05-08-p1-trace-evidence-plane.md` records the decision and rationale.
- `GET /work-items/:workItemId/evidence-chain` and `GET /work-items/:workItemId/evidence-chain?review_packet_id=:reviewPacketId` return reviewer-readable chains with focus, projection, canonical risk flags, supersession semantics, and public-evidence redaction.
- Web Workbench renders Evidence Chain without raw/internal evidence leakage.

## Implementation Notes

- Keep changes scoped to existing P0 module, DB repository, Web Workbench, dogfood scripts, and docs.
- Prefer small helper modules for Evidence Chain construction instead of growing `P0Service`.
- Keep the read model stable even if trace write coverage is initially partial.
- Commit implementation by phase so P0 strict dogfood can be validated independently from Trace/Evidence MVP.
