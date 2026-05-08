# P1 Decision: Trace / Evidence Plane

Date: 2026-05-08

## Status

Accepted

## Decision

Prioritize Trace / Evidence Plane for P1.

## Context

The P0 dogfood batch validates that ForgeLoop can create Work Items, approve Specs and Plans, run Execution Packages, collect terminal evidence, produce Review Packets, and exercise `changes_requested -> rerun -> approve`.

The remaining reviewer pain is evidence reconstruction. A reviewer can find the relevant objects, but they still have to stitch together RunSessions, reruns, artifacts, status history, decisions, and Review Packets to understand why a Work Item is complete.

## Rationale

Trace / Evidence Plane is the highest-leverage P1 because it makes existing P0 evidence reviewer-readable before adding release, incident, or retrospective product surfaces.

It should answer:

- What changed between the original run and rerun?
- Which RunSession produced the approved Review Packet?
- Which required artifacts are present or missing?
- Which evidence is public, redacted, stale, or superseded?
- Why is a Work Item considered complete?

## Rejected Alternatives

### Release

Release is not the right P1 surface yet because packaging approved work into rollout decisions depends on trustworthy evidence. The P0 dogfood showed that Review Packets can be approved, but reviewers still need to manually reconstruct the support chain across runs, artifacts, and reruns before they can trust a release grouping.

### Retrospective / Learning Loop

Retrospective / Learning Loop is also deferred because it depends on high-quality trace inputs. Building learning assets before the evidence chain is reliable would codify weak or incomplete signals instead of improving future execution.

## MVP Scope

The MVP is a reviewer-first Evidence Chain inside the existing Workbench. It should:

- show which RunSessions, Review Packets, decisions, checks, and artifacts support the selected Work Item or Review Packet;
- represent rerun supersession from persisted relationships rather than timestamp inference;
- flag missing required artifacts, unapproved packets, changes requested, stale/superseded evidence, failed checks, and partial projections;
- keep raw logs, `raw_ref`, local artifact refs, and internal payloads redacted from public API and UI output.

The MVP should not create a separate graph product page, full incident replay, release workflow, retrospective generator, or trace-only source of truth.

## Risks

- Trace writes may initially be partial, so the read model must still reconstruct evidence from existing P0 tables.
- Redaction mistakes could expose raw logs or local-only artifact paths.
- Supersession semantics could become misleading if implementation falls back to timestamp-only inference.
- A broad trace model could slow P1 if it expands beyond the reviewer trust question.

## Follow-Up Candidates

- Release grouping and rollout decisions after reviewer evidence is trustworthy.
- Retrospective / Learning Loop once Evidence Chain produces reliable structured inputs.
- Trace backfill and projector jobs after the read-time MVP proves useful.
- Richer graph visualization if the linear chain becomes insufficient.

## Consequences

- P1 should add a reviewer-first Evidence Chain over existing P0 records.
- The Evidence Chain must preserve raw/internal evidence redaction.
- Release and Retrospective/Learning Loop remain follow-up product surfaces after reviewers can trust and inspect the evidence path.
