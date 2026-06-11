# Plan Item Session Operations Runbook

## Purpose

Use Session Operations when a Plan Item Workflow has a stale lease, orphaned action, missing capsule, lineage conflict, or recovered state that needs an explicit human next action.

## Recovery Rules

- Recovery is control-only.
- Recovery does not invoke Codex.
- Recovery does not create sessions.
- Recovery does not fork or select forks.
- Recovery does not retry execution.
- Recovery does not advance workflow status.
- Recovery does not delete capsules.
- Actor identity comes from trusted actor headers, never from the request body.

## Operator Flow

1. Open `/session-operations`.
2. Filter to blocked or attention-needed states.
3. Run scavenge dry-run from `/session-operations` or `scripts/session-operations-scavenge.ts --mode=dry_run`.
4. Inspect the safe candidate summary and export only reviewed candidates.
5. Execute recovery only when the candidate predicate still matches:
   `scripts/session-operations-scavenge.ts --mode=execute --confirm-execute --reason="Operator-reviewed stale control cleanup" --operation-idempotency-key-prefix="scavenge-<ticket-or-date>" --candidates-file=./safe-candidates.json`
6. Confirm the recovery record result.
7. Send the Plan Item owner back to the Plan Item workflow for a separate continue, fork, or archive decision.

## Environment

The scavenge wrapper requires:

- `FORGELOOP_API_BASE_URL`
- `FORGELOOP_ACTOR_ID`
- `FORGELOOP_ACTOR_CLASS`
- `FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET`

Set `FORGELOOP_DAEMON_IDENTITY` only when the actor class is an automation daemon.

## No-Op Results

Skipped or blocked results mean the projection changed or recovery is unsafe. Do not retry by changing the predicate by hand; refresh health and let the system generate a new candidate.

## Audit Expectations

Each execute request must include a reviewed candidate predicate, reason, confirmation flag, and operation idempotency key prefix. The service records the result and keeps capsule retention pins intact so operators can reason about recovery without losing runtime evidence.
