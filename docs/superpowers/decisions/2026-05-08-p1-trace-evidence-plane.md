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

## Consequences

- P1 should add a reviewer-first Evidence Chain over existing P0 records.
- The Evidence Chain must preserve raw/internal evidence redaction.
- Release and Retrospective/Learning Loop remain follow-up product surfaces after reviewers can trust and inspect the evidence path.
