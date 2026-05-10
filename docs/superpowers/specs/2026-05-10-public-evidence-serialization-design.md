# Public Evidence Serialization Boundary Design

## Status

Draft for review.

## Context

The Release Flow foundation now has Release and ReleaseEvidence domain, contract, schema, and repository support. The next prerequisite before Release cockpit and Release replay is to make public evidence and replay serialization a first-class boundary.

Current public evidence serialization is split across multiple places:

- `apps/control-plane-api/src/p0/run-session-serialization.ts` owns artifact redaction for run-session responses.
- `apps/control-plane-api/src/p0/evidence-chain.ts` imports that API-local artifact redaction helper.
- `packages/db/src/queries/replay-queries.ts` has its own artifact redaction implementation and still returns raw `Decision`, `ObjectEvent`, and `StatusHistory` payloads.
- `ReleaseEvidence` exists in contracts/domain/repository code, but there is no shared public serializer for it yet.

Because the project has not launched, this work should remove the historical split instead of preserving compatibility with raw response shapes.

## Problem

Public query and evidence surfaces need one durable rule: raw repository/domain rows must not cross the public API boundary.

The current shape leaves three risks:

1. Duplicate artifact redaction rules can drift.
2. Replay payloads can expose newly added raw fields by accident.
3. Release cockpit/replay work would otherwise build on an unclear serialization boundary.

## Goals

- Define public evidence and replay DTO schemas in `packages/contracts`.
- Add one shared serializer module for public evidence and replay payloads.
- Use allowlists per payload type rather than copying raw objects and deleting fields afterward.
- Replace the duplicated artifact redaction implementations with the shared serializer.
- Keep current Evidence Chain redaction behavior while moving its public artifact rules to the shared module.
- Make ReleaseEvidence serialization available for the next Release cockpit/replay task without implementing those routes in this task.
- Add tests that prove public surfaces do not leak raw/local/sensitive evidence.

## Non-Goals

- Do not implement `ReleaseModule`.
- Do not implement Release cockpit read models.
- Do not implement `GET /query/replay/release/:releaseId`.
- Do not add UI work.
- Do not preserve compatibility with raw replay payload responses.
- Do not introduce a generic object sanitizer as a substitute for typed allowlist serializers.

## Design Summary

Create a strict public serialization boundary:

```text
repository/domain row
  -> type-specific allowlist serializer
  -> recursive sanitizer for allowlisted nested payloads
  -> public contract parse
  -> query/API response
```

The serializer should live at:

```text
packages/db/src/queries/public-evidence-serialization.ts
```

Public DTO schemas should live in contracts, close to the existing evidence-chain and release contracts. The exact file split can follow current package conventions, but the exported schemas must be available to API and db query code through `@forgeloop/contracts`.

Dependency direction must stay one-way:

- `packages/contracts` owns public DTO schemas and imports no app/db code.
- `packages/db` may import `@forgeloop/contracts` and `@forgeloop/domain`.
- `apps/control-plane-api` may import the shared serializer from `@forgeloop/db`.
- `packages/db` must not import API code.

This task must add `@forgeloop/contracts: "workspace:*"` to `packages/db/package.json`. The serializer must not rely on an undeclared transitive dependency.

## Public Contracts

Add public DTO schemas and inferred types for:

- `PublicArtifactRef`
- `PublicDecision`
- `PublicObjectEvent`
- `PublicStatusHistory`
- `PublicReleaseEvidence`
- `PublicReplayEntry`

Export all public DTO schemas and types from the contracts package root so API and db code can import them from `@forgeloop/contracts`.

The public DTOs intentionally differ from domain rows. They are response shapes, not persistence shapes.

All public DTO schemas must be strict. Unknown fields should fail contract parsing rather than being silently preserved.

### PublicArtifactRef

Expose safe artifact metadata only:

```ts
type PublicArtifactKind = Exclude<ArtifactKind, "logs" | "raw_metadata">;

type PublicArtifactRef = {
  kind: PublicArtifactKind;
  name: string;
  content_type: string;
  storage_uri: string;
  digest?: string;
};
```

Never expose:

- `local_ref`
- `raw_ref`
- logs artifact bodies
- raw metadata artifact bodies
- local filesystem paths

`storage_uri` is required on `PublicArtifactRef` because public artifact refs never expose `local_ref`. Unsafe artifact refs serialize to `undefined`, allowing callers to omit them or create explicit redaction evidence items.

Public `storage_uri` policy:

- Allowed schemes: `s3://`, `gs://`, and `https://`.
- For `https://`, the host must be non-empty. For `s3://` and `gs://`, the bucket/host segment must be non-empty.
- Redact the artifact if `storage_uri` is absent, relative, absolute local path, repository-local absolute path, `file://...`, `local://...`, `http://...`, or any unknown scheme.
- Redact the artifact if the URI string contains an embedded absolute local path such as `/Users/`, `/home/`, `/tmp/`, or `/var/`.
- Redact the artifact if `storage_uri` includes userinfo, query parameters, or a fragment. Public artifact URIs must be stable object locations, not signed URLs or credential-bearing links.

### PublicDecision

Expose only:

```ts
type PublicDecision = {
  id: string;
  object_type: string;
  object_id: string;
  actor_id: string;
  decided_by_actor_id?: string;
  decision_type?: string;
  outcome?: string;
  decision: "approved" | "changes_requested" | "need_more_context" | "escalate" | "override_approved";
  summary: string;
  rationale?: string;
  created_at: string;
};
```

Do not expose `evidence_refs` in this task. The current domain field is `unknown`, so it is not safe to make public until a strict public reference schema exists.

### PublicObjectEvent

Expose only:

```ts
type PublicObjectEventPayload = {
  release_id?: string;
  work_item_id?: string;
  execution_package_id?: string;
  run_session_id?: string;
  review_packet_id?: string;
  spec_id?: string;
  spec_revision_id?: string;
  plan_id?: string;
  plan_revision_id?: string;
  artifact_id?: string;
  decision_id?: string;
  trace_event_id?: string;
  command_id?: string;
  status?: string;
  from_status?: string;
  to_status?: string;
  phase?: string;
  activity_state?: string;
  gate_state?: string;
  resolution?: string;
  outcome?: string;
  decision?: string;
  result?: string;
  mode?: string;
  workflow_only?: boolean;
  executor_type?: string;
  reason?: string;
  summary?: string;
  blocker_codes?: string[];
  required_check_ids?: string[];
  failed_check_ids?: string[];
  missing_artifact_kinds?: PublicArtifactKind[];
};

type PublicObjectEvent = {
  id: string;
  object_type: string;
  object_id: string;
  event_type: string;
  actor_type?: "human" | "ai" | "system";
  actor_id?: string;
  reason?: string;
  payload: PublicObjectEventPayload;
  created_at: string;
};
```

`payload` must always be present, defaulting to `{}` when the source row has no public payload. Its zod schema must be a strict object with the optional keys above, not `z.record(...)`.

Allowed payload keys are intentionally small and event-type-independent for this task:

- ids: `release_id`, `work_item_id`, `execution_package_id`, `run_session_id`, `review_packet_id`, `spec_id`, `spec_revision_id`, `plan_id`, `plan_revision_id`, `artifact_id`, `decision_id`, `trace_event_id`, `command_id`;
- status/lifecycle: `status`, `from_status`, `to_status`, `phase`, `activity_state`, `gate_state`, `resolution`, `outcome`, `decision`, `result`;
- operation descriptors: `mode`, `workflow_only`, `executor_type`, `reason`, `summary`, `blocker_codes`, `required_check_ids`, `failed_check_ids`, `missing_artifact_kinds`.

Unknown payload keys are dropped. Unknown event types still use this key allowlist; if no keys survive, `payload` is `{}`. Never expose `metadata`.

### PublicStatusHistory

Expose only:

```ts
type PublicStatusHistoryContext = {
  release_id?: string;
  work_item_id?: string;
  execution_package_id?: string;
  run_session_id?: string;
  review_packet_id?: string;
  actor_id?: string;
  reason?: string;
  summary?: string;
  blocker_codes?: string[];
  required_check_ids?: string[];
  failed_check_ids?: string[];
  missing_artifact_kinds?: PublicArtifactKind[];
  previous_value?: string | number | boolean | null;
  next_value?: string | number | boolean | null;
};

type PublicStatusHistory = {
  id: string;
  object_type: string;
  object_id: string;
  field_name?: string;
  from_status?: string;
  to_status: string;
  from_value?: string;
  to_value?: string;
  actor_type?: "human" | "ai" | "system";
  actor_id?: string;
  reason?: string;
  context: PublicStatusHistoryContext;
  created_at: string;
};
```

`context` must always be present, defaulting to `{}` when the source row has no public context. Its zod schema must be a strict object with the optional keys above, not `z.record(...)`.

Allowed context keys:

- `release_id`
- `work_item_id`
- `execution_package_id`
- `run_session_id`
- `review_packet_id`
- `actor_id`
- `reason`
- `summary`
- `blocker_codes`
- `required_check_ids`
- `failed_check_ids`
- `missing_artifact_kinds`
- `previous_value`
- `next_value`

Unknown context keys are dropped. Do not expose raw transition context.

### PublicReleaseEvidence

Expose only:

```ts
type PublicReleaseEvidence = {
  id: string;
  release_id: string;
  evidence_type: ReleaseEvidenceType;
  summary: string;
  object_ref?: ReleaseEvidenceObjectRef;
  artifact_id?: string;
  artifact?: PublicArtifactRef;
  extra: PublicReleaseEvidenceExtra;
  redacted: boolean;
  status: "current" | "stale" | "superseded";
  created_at: string;
  created_by_actor_id?: string;
};
```

Do not expose ReleaseEvidence `org_id`, `project_id`, `key`, `title`, `description`, `visibility`, `source_type`, `labels`, `updated_at`, or `updated_by_actor_id` in this task.

`object_ref` must remain within the existing ReleaseEvidence object-ref contract. Unknown object-ref fields are dropped.

`extra` only allows these top-level groups:

- `observation`
- `deployment`
- `rollback`
- `build`
- `check_refs`

Each group must have its own allowlist. Unknown top-level `extra` keys are dropped.

Exact `extra` group shapes:

```ts
type PublicReleaseEvidenceExtra = {
  observation?: {
    source: "human" | "script";
    severity: "info" | "warning" | "failure";
    summary: string;
    observed_at: string;
    actor_id?: string;
    links?: Array<{
      object_type: "release" | "work_item" | "execution_package" | "run_session" | "review_packet";
      object_id: string;
      relationship: "observed" | "affected" | "supports" | "blocks";
    }>;
    metrics?: PublicMetrics;
    notes?: string;
  };
  deployment?: {
    environment: string;
    result: "succeeded" | "failed" | "cancelled" | "in_progress";
    deployment_id?: string;
    target?: string;
    version?: string;
    started_at?: string;
    completed_at?: string;
    actor_id?: string;
    notes?: string;
  };
  rollback?: {
    result: "succeeded" | "failed" | "cancelled" | "not_required";
    reason?: string;
    rollback_id?: string;
    target?: string;
    started_at?: string;
    completed_at?: string;
    actor_id?: string;
    notes?: string;
  };
  build?: {
    build_id?: string;
    version?: string;
    commit_sha?: string;
    source_branch?: string;
    result?: "succeeded" | "failed" | "cancelled" | "in_progress";
    started_at?: string;
    completed_at?: string;
    artifact_id?: string;
    artifact?: PublicArtifactRef;
  };
  check_refs?: Array<{
    check_id: string;
    status: "succeeded" | "failed" | "skipped";
    summary?: string;
    artifact_id?: string;
    artifact?: PublicArtifactRef;
  }>;
};

type PublicMetrics = Record<string, string | number | boolean | null>;
```

`PublicMetrics` is the only public DTO field that allows dynamic object keys. Its zod schema must validate every metric key with the same unsafe-key matcher used by the sanitizer and reject unsafe keys such as `accessToken`, `client_secret`, `private_key`, `token`, and `authorization`. It must also reject string metric values when `isLocalReferenceString(value)` is true.

If a nested artifact in `extra.build` or `extra.check_refs` is not public under `PublicArtifactRef`, omit that nested `artifact` field and keep the rest of the safe group.

If sanitization removes required fields from an `extra` group, omit that group rather than returning an invalid group or throwing because of untrusted stored data. The final `PublicReleaseEvidence.extra` object may be `{}`.

Allowed nested fields must still validate after sanitization:

- invalid optional scalar fields are omitted;
- invalid arrays keep only valid elements and are omitted if no valid elements remain;
- `missing_artifact_kinds` arrays keep only `PublicArtifactKind` values, filtering out `logs`, `raw_metadata`, and non-string values;
- malformed `PublicObjectEvent.payload` and `PublicStatusHistory.context` fields are omitted field-by-field;
- malformed `PublicReleaseEvidence.extra` groups are omitted group-by-group.

### PublicReplayEntry

Define replay entries as a discriminated union by `source`:

```ts
type PublicReplayEntryBase = {
  id: string;
  object_type: string;
  object_id: string;
  summary: string;
  created_at: string;
};

type PublicReplayEntry =
  | (PublicReplayEntryBase & { source: "object_event"; payload: PublicObjectEvent })
  | (PublicReplayEntryBase & { source: "status_history"; payload: PublicStatusHistory })
  | (PublicReplayEntryBase & { source: "decision"; payload: PublicDecision })
  | (PublicReplayEntryBase & { source: "artifact"; payload: PublicArtifactRef })
  | (PublicReplayEntryBase & { source: "release_evidence"; payload: PublicReleaseEvidence });
```

`release_evidence` is included now so the next Release replay task can reuse the same contract, but this task does not add release replay routes.

## Sanitization Rules

The sanitizer is a helper used only inside typed serializers. It must not be the primary public boundary.

It recursively removes object entries whose normalized key is unsafe.

Normalize keys by converting camelCase to snake_case, lowercasing, and replacing non-alphanumeric runs with `_`. For example, `accessToken`, `access-token`, and `access_token` all normalize to `access_token`.

Unsafe key rules:

- exact normalized keys: `raw_ref`, `local_ref`, `raw_metadata`, `raw_payload`, `raw_logs`, `logs`, `stdout`, `stderr`, `env`, `environment_variables`, `headers`, `authorization`, `auth_header`, `cookie`, `set_cookie`, `api_key`, `password`, `credential`, `credentials`, `secret`, `token`, `access_token`, `refresh_token`, `client_secret`, `private_key`;
- suffixes: `_token`, `_secret`, `_password`, `_credential`, `_credentials`, `_api_key`, `_private_key`;
- prefixes: `secret_`, `password_`, `credential_`, `credentials_`;
- no fuzzy substring matching. For example, `token_count` and `secretary_note` are preserved unless an allowlist excludes them.

It recursively removes string values where `isLocalReferenceString(value)` is true.

`isLocalReferenceString` must:

- percent-decode before checking when decoding succeeds;
- return true for `file://...` and `local://...`;
- return true for relative artifact paths beginning with `artifacts/`, `./artifacts/`, or `../artifacts/`;
- return true for Windows drive paths such as `C:\Users\viv\out.log`;
- return true for UNC paths such as `\\server\share\out.log`;
- return true for strings that are or contain absolute local POSIX paths beginning with `/Users/`, `/home/`, `/tmp/`, `/private/tmp/`, `/var/`, `/workspace/`, `/workspaces/`, `/opt/`, `/mnt/`, `/Volumes/`, or the repository root prefix;
- return false for ordinary route-like strings such as `/query/replay/work_item/1` unless they match one of the local prefixes above.

For arrays, remove unsafe elements and preserve the order of surviving elements. For objects, remove unsafe fields and preserve the surviving fields. Empty objects and arrays may remain when they are the value of an allowed field. The sanitizer should not rewrite unsafe strings; unsafe fields or elements should be omitted.

## Artifact Redaction Rules

`artifactRedactionReason` should be exported from the shared serializer module so Evidence Chain can continue to produce explicit redaction items.

Reasons must remain compatible with the existing Evidence Chain contract:

- `logs_artifact`
- `raw_metadata_artifact`
- `raw_ref`
- `local_ref_only`
- `unsafe_storage_uri`

`unsafe_storage_uri` is new in this task and must be added to the Evidence Chain redaction reason contract.

Rules:

- `kind === "logs"` is redacted.
- `kind === "raw_metadata"` is redacted.
- any `raw_ref` is redacted.
- `local_ref` without `storage_uri` is redacted.
- `local_ref` with a public `storage_uri` may keep the artifact, but `local_ref` itself is removed.
- any non-public `storage_uri` is redacted even if `local_ref` is absent.

## Shared Serializer API

The shared module should export:

```ts
artifactRedactionReason(artifact): EvidenceChainRedactionReason | undefined
serializePublicArtifactRef(artifact): PublicArtifactRef | undefined
serializePublicArtifactRefs(artifacts): PublicArtifactRef[]
serializePublicDecision(decision): PublicDecision
serializePublicObjectEvent(objectEvent): PublicObjectEvent
serializePublicStatusHistory(statusHistory): PublicStatusHistory
serializePublicReleaseEvidence(input): PublicReleaseEvidence
serializePublicReplayPayload(source, payload): PublicReplayEntry["payload"]
serializePublicReplayEntry(entry): PublicReplayEntry
```

`serializePublicReleaseEvidence` must accept this input shape:

```ts
type SerializePublicReleaseEvidenceInput = {
  evidence: ReleaseEvidence;
  artifact?: Artifact | ArtifactRef;
};
```

If `artifact` is an `Artifact`, use its `ref`. If it is an `ArtifactRef`, use it directly. If the artifact is unsafe, omit `artifact` from the public output while preserving `artifact_id`.

Every serializer should construct a fresh object from allowlisted fields and parse it with the matching contract schema before returning.

`serializePublicReplayEntry` must parse the final discriminated union so the `source` and `payload` type cannot drift. `serializePublicReplayPayload` is a helper only; callers should prefer `serializePublicReplayEntry` when constructing response entries.

## Integration Points

### Package Dependencies And Exports

Update `packages/db/package.json`:

- add `@forgeloop/contracts: "workspace:*"` to dependencies.

Update package barrels:

- export public DTO schemas and types from `packages/contracts/src/index.ts`;
- export `packages/db/src/queries/public-evidence-serialization.ts` from `packages/db/src/index.ts`.

App code must import shared serializer exports from `@forgeloop/db`.

### Replay Queries

Update `packages/db/src/queries/replay-queries.ts` to:

- remove its local artifact redaction functions;
- use `serializePublicArtifactRef` for artifact entries;
- use public serializers for Decision, ObjectEvent, and StatusHistory payloads;
- type `TimelineEntry.payload` as the public replay payload union instead of raw domain types.

Existing work-item replay behavior should remain functionally the same except payloads become public DTOs.

### Evidence Chain

Update `apps/control-plane-api/src/p0/evidence-chain.ts` to import `artifactRedactionReason` and `serializePublicArtifactRef` from the shared serializer module.

Current redaction item behavior should remain unchanged:

- unsafe artifacts create explicit public redaction evidence items;
- safe artifact items keep the current Evidence Chain shape: subject, summary, links, and risk flags only;
- this task does not add `details.artifact` to `EvidenceChainItem`, because the current Evidence Chain contract is strict;
- run events/logs/internal events are still redacted as they are today.

### Run Session Serialization

Update `apps/control-plane-api/src/p0/run-session-serialization.ts` to reuse shared artifact serialization for:

- run-session `artifacts`;
- check result `stdout`;
- check result `stderr`;
- executor result artifacts.

Run-session-specific redaction remains in this file, including:

- clearing `log_refs`;
- hiding `run_spec`;
- reducing `runtime_metadata`;
- clearing executor `raw_metadata`.

## Testing Plan

Add failing tests before implementation.

### Query Module Tests

In `tests/api/query-module.test.ts`, assert work-item replay:

- omits `raw_ref`;
- omits `local_ref`;
- omits local-only artifacts;
- omits artifacts with non-public `storage_uri` values, including `/Users/...`, `file://...`, `local://...`, `http://...`, `https://user:pass@example.test/object`, `https://example.test/object?token=...`, `https://example.test/object#frag`, `s3://bucket/key?x=y`, `gs://bucket/key#frag`, `https://example.test/%2FUsers%2Fviv%2Fout.log`, and `artifacts/...`;
- omits logs and raw metadata artifacts;
- strips nested token/secret/password-like keys;
- strips local path strings from allowed nested payloads and arrays;
- returns public Decision/ObjectEvent/StatusHistory payloads, not raw domain rows.

### Evidence Chain Tests

In `tests/api/evidence-chain.test.ts`, assert Evidence Chain:

- still emits redaction items for unsafe artifacts;
- emits `unsafe_storage_uri` redaction items for artifacts whose `storage_uri` is not public;
- does not expose `raw_ref`, `local_ref`, local paths, local URI strings, raw metadata payloads, log bodies, token, or secret fields in details;
- continues to expose safe artifact items for artifacts with durable `storage_uri` through subject and summary, without adding `details.artifact`.

### Contract Tests

In `tests/contracts/evidence-chain.test.ts` or a focused contracts test file, assert public DTO schemas:

- reject raw/local fields when provided directly;
- reject unknown fields on strict public DTOs;
- reject unknown nested keys in `PublicObjectEvent.payload`, `PublicStatusHistory.context`, and `PublicReleaseEvidence.extra`, except for validated dynamic `PublicMetrics` keys;
- reject unsafe dynamic metric keys and values, including `metrics.accessToken`, `metrics.client_secret`, `metrics.private_key`, and `metrics.output_path: "/Users/..."`;
- reject `PublicArtifactRef.kind` values `logs` and `raw_metadata`;
- reject public artifacts without a public `storage_uri`, with userinfo, with query parameters, with fragments, with empty hosts, or with percent-encoded local paths;
- include `unsafe_storage_uri` in the Evidence Chain redaction reason enum;
- accept safe public replay/evidence payloads.

### Serializer Tests

Add focused serializer tests if API tests become too indirect. Cover:

- ReleaseEvidence `extra.observation`;
- ReleaseEvidence `extra.deployment`;
- ReleaseEvidence `extra.rollback`;
- ReleaseEvidence `extra.build`;
- ReleaseEvidence `extra.check_refs`;
- unknown `extra` groups being dropped;
- sensitive nested keys being dropped inside allowed groups.

Use a shared hostile fixture matrix in serializer tests and at least one API-level test. It should include:

- key variants: `token`, `accessToken`, `access_token`, `clientSecret`, `client_secret`, `authorization`, `auth_header`, `api_key`, `password`, `private_key`;
- safe near-misses: `token_count`, `secretary_note`;
- path/URI variants: `/Users/viv/projs/forgeloop/out.log`, `/home/runner/out.log`, `/workspace/app/out.log`, `/opt/build/out.log`, `/tmp/out.log`, `C:\Users\viv\out.log`, `\\server\share\out.log`, `file:///Users/viv/out.log`, `local://run/out.log`, `artifacts/run/out.log`, `https://example.test/artifact?token=secret`, `https://user:pass@example.test/object`, `https://example.test/object#frag`, `https://example.test/%2FUsers%2Fviv%2Fout.log`;
- nested arrays and objects where only unsafe elements/fields should be removed.

## Migration And Cleanup

Because there is no launched compatibility promise:

- remove duplicated artifact serializer implementations instead of leaving wrappers with independent logic;
- update imports to point at the shared module;
- update replay payload types to public DTOs;
- update tests to assert the new public shapes directly.

Do not add deprecated raw replay response aliases.

## Acceptance Criteria

- Public DTO schemas exist in `packages/contracts` and are exported.
- `packages/db` declares its `@forgeloop/contracts` dependency.
- `packages/db/src/queries/public-evidence-serialization.ts` is the only implementation of public artifact redaction.
- Public DTO schemas are strict and define concrete optionality, replay source/payload mappings, ReleaseEvidence artifact metadata, and ReleaseEvidence `extra` group allowlists.
- Replay queries no longer return raw Decision/ObjectEvent/StatusHistory payloads.
- Evidence Chain and run-session serialization reuse shared artifact serialization.
- Public surfaces do not expose raw refs, local refs, local filesystem paths, local URI strings, logs, raw metadata, or deterministic token/secret-like fields.
- Artifacts with non-public `storage_uri` values are redacted.
- ReleaseEvidence public serialization exists and is tested, even though Release cockpit/replay routes are not implemented in this task.
- The relevant API and contract tests pass.

## Follow-Up

After this task lands, the next task should implement Release cockpit and Release replay read models on top of the shared public serializers.
