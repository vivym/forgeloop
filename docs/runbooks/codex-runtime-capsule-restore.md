# Codex Runtime Capsule Restore Runbook

This runbook covers the cross-worker capsule restore dogfood for Codex runtime capsule packaging. The dogfood verifies that a capsule produced from one isolated worker root can be restored into a second isolated worker root with digest continuity for thread locator state, memory state, environment manifest state, and follow-on capsule packaging.

## Prerequisites

- Dependencies installed with `pnpm install`.
- A clean working tree for the dogfood branch.
- Discovery dogfood available through the package script below.
- Real local credentials only when attempting a real pass. Missing credentials are an accepted local skip, not a failure.
- No public report may include raw thread ids, raw memory text, internal artifact refs, credential/config filenames, absolute machine paths, or secrets.

## Commands

Run discovery first:

```bash
pnpm dogfood:codex-runtime-capsule-discovery
```

Run restore dogfood:

```bash
pnpm dogfood:codex-runtime-capsule-restore
```

The restore report is written to:

```text
test-results/codex-runtime-capsule-restore-report.json
```

## Output Shape

`PASS` means the dogfood produced a product-safe report after exercising package, restore, memory replay, environment digest continuity, and second capsule package checks.

```text
PASS codex_runtime_capsule_restore_cross_worker_restore
Report: test-results/codex-runtime-capsule-restore-report.json
Discovery report digest: sha256:...
Memory input digest: sha256:...
Memory output digest: sha256:...
Environment manifest digest: sha256:...
First capsule digest: sha256:...
Second capsule digest: sha256:...
Restore checks digest: sha256:...
```

`SKIP` means local credentials are unavailable for a real local run. This exits 0 and writes only the product-safe reason code.

```text
SKIP codex_runtime_capsule_restore_credentials_unavailable
```

`BLOCKED` means discovery or restore prerequisites failed. The output and JSON report include blocker codes only.

```text
BLOCKED codex_runtime_capsule_discovery_locator_repair_manifest_missing
```

## Report Policy

The JSON report is limited to:

- status values;
- reason or blocker codes;
- digest fields;
- restore check statuses;
- memory delta operation counts;
- repo-relative report path.

The report must not include raw thread identifiers, raw memory text, internal artifact references, credential/config filenames, absolute paths, or secret values. Use digests and counts for evidence. If a failure needs investigation, inspect private runtime artifacts outside the public report path.

## Local Skip Behavior

Local and CI environments may not have the credentials needed for real Codex discovery and restore. In that case the restore dogfood must return:

```text
SKIP codex_runtime_capsule_restore_credentials_unavailable
```

Do not convert this skip into a pass. A real `PASS` is valid only after the operator has real credentials available and the restore script completes the full cross-worker scenario.
