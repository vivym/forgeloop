# Internal Artifact Store Foundation Design

## Status

Wave 1 design for `2026-05-30-plan-item-codex-session-continuity-generation-loop-design.md`.

## Purpose

ForgeLoop needs a private object-store abstraction before Codex session snapshots, workspace bundles, execution packages, generated payload spillover, and review artifacts can share one safe storage path.

The current repo already has several artifact-like surfaces:

- product Attachments for user-visible document and evidence assets;
- public artifact refs for release/readiness evidence;
- executor `ArtifactRef`, which can still represent local refs;
- `CodexRuntimeJobArtifact`, which is scoped to one runtime job and enforces worker-session intake;
- pending workspace bundle records, which currently store archive bytes and metadata in a runtime-specific shape.

Those are not a general internal object store. Wave 1 introduces a reusable internal ArtifactStore while keeping domain ownership explicit.

## Authority

This spec implements only Wave 1: Internal Artifact Store Foundation.

It is authoritative for:

- internal artifact object model;
- local filesystem backend;
- `artifact://` internal ref format and validation;
- trusted worker upload/download API shape;
- relation between new ArtifactStore and existing `CodexRuntimeJobArtifact`;
- security and verification gates for internal artifacts.

It is not authoritative for:

- CodexSession schema;
- CodexSessionSnapshot schema beyond future-consumer constraints;
- app-server resume;
- `CODEX_HOME` packaging;
- Plan Item workflow UI;
- execution continuation.

## Problem

Internal binary and JSON payloads need durable storage, but the current storage surfaces are too specific or too public:

- Product Attachments are for user-visible evidence and authoring assets. They carry document ownership, render URLs, attachment safety state, and UI references.
- Public artifacts intentionally expose public-safe storage locations.
- Executor `ArtifactRef` allows `local_ref`, which is useful for process results but unsafe as a durable cross-worker contract.
- `CodexRuntimeJobArtifact` is bound to `runtime_job_id` and worker-session proof. It cannot represent snapshots owned by `codex_session_id`, workspace bundles owned by run sessions, or future internal objects that outlive a single job.

Without a first-class internal store, later waves would either duplicate storage code or overload `codex_runtime_job_artifacts` into a generic blob registry. Both options leave historical baggage and make snapshot security harder to audit.

## Goals

- Provide one internal object-store-shaped interface for durable private artifacts.
- Use local filesystem storage in v0 through `FORGELOOP_ARTIFACT_STORE_ROOT`.
- Store metadata in DB/repository records, not only on disk.
- Return opaque `artifact://` refs, never local filesystem paths.
- Preserve domain ownership with explicit owner fields and consumer binding records.
- Support trusted worker upload and download flows.
- Enforce digest, size, content type, visibility, and namespace validation.
- Make existing runtime job artifacts consume the internal store rather than remain an isolated storage model.
- Keep product Attachments completely separate from internal session/runtime artifacts.

## Non-Goals

- No S3, R2, GCS, or MinIO backend in Wave 1.
- No Codex session snapshot packaging in Wave 1.
- No runtime `CODEX_HOME` restore in Wave 1.
- No public download endpoint for internal artifacts.
- No product Attachment reuse for Codex session snapshots.
- No `local_ref` in any persisted internal ArtifactStore ref.
- No migration compatibility layer that preserves old local-path semantics.
- No generic product UI for browsing internal artifacts.

## Core Decision

Introduce `InternalArtifactObject` as the storage authority and keep domain-specific records as ownership or usage edges.

```text
InternalArtifactObject
  -> owns storage key, digest, size, content type, visibility, owner

CodexRuntimeJobArtifact
  -> runtime-job-scoped usage record pointing at InternalArtifactObject

Future CodexSessionSnapshot
  -> session-scoped usage record pointing at InternalArtifactObject

Future WorkspaceBundle / ExecutionPackage / ReviewPacket artifacts
  -> domain-scoped usage records pointing at InternalArtifactObject
```

The store is generic at the storage layer, not at the product layer. Consumers must still pass through their domain service and permission checks.

## Data Model

### Internal Artifact Object

Mandatory contract shape:

```ts
type InternalArtifactVisibility = 'internal' | 'private';

type InternalArtifactKind =
  | 'codex_session_snapshot'
  | 'codex_runtime_job_artifact'
  | 'workspace_bundle'
  | 'generated_payload'
  | 'execution_patch'
  | 'review_packet'
  | 'logs'
  | 'raw_metadata';

type InternalArtifactOwnerType =
  | 'codex_runtime_job'
  | 'codex_session'
  | 'run_session'
  | 'execution_package'
  | 'review_packet'
  | 'automation_action_run'
  | 'system';

type InternalArtifactObject = {
  id: string;
  artifact_id: string;
  ref: string;
  storage_key: string;
  kind: InternalArtifactKind;
  content_type: string;
  size_bytes: string;
  digest: string;
  visibility: InternalArtifactVisibility;
  owner_type: InternalArtifactOwnerType;
  owner_id: string;
  idempotency_key: string;
  request_digest: string;
  metadata_json: Record<string, unknown>;
  created_by_actor_type: 'codex_worker' | 'system' | 'user';
  created_by_actor_id: string;
  created_at: string;
  deleted_at?: string;
};
```

Rules:

- `ref` is the only durable external identifier and must start with `artifact://`.
- `id` is the DB row id and must be a UUID.
- `artifact_id` is the text segment used in the canonical ref.
- `storage_key` is internal server-side metadata and must never be returned in normal product DTOs.
- `size_bytes` is serialized as a decimal string in contracts and DTOs, and stored as a 64-bit integer in DB.
- `digest` must be a `sha256:` digest computed over stored bytes.
- `visibility = internal` means trusted runtime/control-plane only.
- `visibility = private` means server-side domain code may reference the object, but public DTOs still receive only product-safe derived refs when a consumer explicitly provides them.
- `idempotency_key` is scoped by `(owner_type, owner_id, idempotency_key)`.
- `request_digest` is computed from the canonical request payload: schema version, artifact id, canonical ref, owner type, owner id, idempotency key, kind, visibility, content type, declared size, declared artifact byte digest, and canonical metadata JSON.
- `deleted_at` is a tombstone. The local file may be removed later by retention, but refs must not be silently reused.

DB constraints:

- table name: `internal_artifact_objects`;
- `id` is UUID primary key;
- `artifact_id`, `ref`, `storage_key`, `kind`, `content_type`, `digest`, `visibility`, `owner_type`, `owner_id`, `idempotency_key`, `request_digest`, `metadata_json`, `created_by_actor_type`, `created_by_actor_id`, and `created_at` are required;
- `size_bytes` must use a 64-bit integer type because future snapshots and workspace bundles may exceed 2 GB;
- `deleted_at` is nullable;
- `created_by_actor_id` is not nullable and is intentionally not a cross-table FK because actors can be users, workers, or system identities;
- unique index on `ref`;
- unique index on `(owner_type, owner_id, idempotency_key)`;
- unique index on `(owner_type, owner_id, kind, artifact_id)`;
- index on `(owner_type, owner_id, kind, created_at)`;
- index on `storage_key`;
- index on `(digest, content_type)`;
- `storage_key` is not unique because multiple owners/refs may point at the same content-addressed bytes;
- tombstoned refs remain unique and cannot be reused.

Idempotency rules:

- `artifact_id` is the artifact id used in the canonical ref.
- A replay with the same `(owner_type, owner_id, idempotency_key)` succeeds only when `request_digest`, digest, size, content type, visibility, metadata, and ref match the existing row.
- A replay with the same idempotency key but different bytes, metadata, visibility, or ref is rejected as `internal_artifact_idempotency_drift`.
- A second write with the same canonical ref and a different idempotency key is always rejected as `internal_artifact_ref_conflict`.
- Tombstoned refs cannot be reused.

Artifact id rules:

- Runtime job artifacts use `deterministicRuntimeArtifactId(runtime_job_id, artifact_idempotency_key)`, matching the current deterministic id contract.
- Workspace bundles use the existing `bundle_id`.
- Future Codex session snapshots use the future `snapshot_id`; Wave 1 only reserves the namespace.
- Admin/operator direct writes use a server-generated UUID string as `artifact_id`; clients may not choose arbitrary ids.
- The control plane derives the canonical ref after authorization; workers submit idempotency inputs and bytes, not refs.

### Ref Format

Refs are opaque strings with validated namespace structure:

```text
artifact://internal/{kind}/{owner_type}/{owner_id}/{artifact_id}
```

Examples:

```text
artifact://internal/codex_runtime_job_artifact/codex_runtime_job/{runtime_job_id}/{artifact_id}
artifact://internal/codex_session_snapshot/codex_session/{codex_session_id}/{snapshot_id}
artifact://internal/workspace_bundle/run_session/{run_session_id}/{bundle_id}
```

Ref rules:

- only lowercase letters, digits, `_`, `-`, and `/` are allowed after `artifact://internal/`;
- no `..`, `.`, empty path segment, backslash, URL-encoded slash, query string, fragment, or scheme nesting;
- `kind`, `owner_type`, `owner_id`, and `artifact_id` must match the metadata row;
- local filesystem paths are never accepted as refs;
- public `ArtifactRef` and `PublicArtifactRef` schemas must not be widened to accept internal refs.

### Local Filesystem Backend

v0 stores bytes under:

```text
FORGELOOP_ARTIFACT_STORE_ROOT=/var/lib/forgeloop/artifacts
```

Required path layout:

```text
{root}/objects/sha256/{first_two_hex}/{full_hex_digest}
{root}/tmp/{request_id}
```

The local path is content-addressed by digest, while DB metadata maps owner/ref to digest.

Backend rules:

- create the root with restrictive permissions;
- write to a temp file first, fsync when available, then atomic rename into content-addressed location;
- recompute digest while writing and reject mismatch;
- reject files larger than the caller's declared policy limit;
- never follow symlinks from root, temp, or object paths;
- verify resolved paths stay under `FORGELOOP_ARTIFACT_STORE_ROOT`;
- return streams by ref only after DB metadata and digest checks pass;
- deleting an object tombstones metadata first, then removes bytes only when no remaining metadata row references the digest.

## Store Interface

The application must expose a typed internal service, not raw filesystem helpers.

```ts
interface InternalArtifactStore {
  putObject(input: PutInternalArtifactObjectInput): Promise<InternalArtifactObject>;
  getObject(ref: string): Promise<InternalArtifactObjectRead>;
  statObject(ref: string): Promise<InternalArtifactObject>;
  deleteObject(ref: string, input: DeleteInternalArtifactObjectInput): Promise<InternalArtifactObject>;
}
```

`putObject` input must include:

- kind;
- owner type and id;
- visibility;
- content type;
- declared size;
- declared digest;
- metadata;
- actor identity;
- idempotency key;
- readable byte stream or byte buffer;
- max size policy.

`getObject` returns:

- metadata row;
- readable stream;
- verified content length when known;
- verified digest metadata.

The store must not expose helper methods that accept an arbitrary local path to publish.

## Relation To Existing Runtime Job Artifacts

`CodexRuntimeJobArtifact` remains the runtime-job usage record, but it must stop being the storage authority.

Wave 1 implementation must change runtime-job artifact intake to:

1. validate worker session, runtime job ownership, job status, nonce, content type, size, digest, artifact id, and idempotency key;
2. write bytes through `InternalArtifactStore.putObject`;
3. persist or update `codex_runtime_job_artifacts` as a domain binding record that stores `internal_artifact_object_id` or `internal_artifact_ref`;
4. return the same public-safe runtime job artifact projection expected by existing terminalization code.

This keeps current runtime job security checks while preventing a second artifact storage model.

Important constraints:

- `CodexRuntimeJobArtifact` may keep `runtime_job_id`, `artifact_idempotency_key`, `kind`, `name`, and terminal artifact validation.
- Detailed runtime artifact kinds such as `generated_payload`, `generation_validation_report`, `startup_failure_evidence`, `cleanup_failure_evidence`, `run_execution_patch`, and `workspace_bundle` remain in `codex_runtime_job_artifacts.kind`.
- The backing `InternalArtifactObject.kind` for runtime artifact rows is `codex_runtime_job_artifact`, except workspace bundles whose backing kind is `workspace_bundle`.
- Detailed runtime artifact kind remains on the `codex_runtime_job_artifacts.kind` binding row. For example, generated payload resolution checks binding-row kind `generated_payload` plus backing object kind `codex_runtime_job_artifact`.
- It must not own local storage paths.
- It must not be reused for Codex session snapshots, because snapshots are owned by `codex_session_id`, not `runtime_job_id`.
- New runtime job artifact refs are deterministic:

```text
artifact://internal/codex_runtime_job_artifact/codex_runtime_job/{runtime_job_id}/{artifact_id}
```

- New workspace bundle refs are deterministic:

```text
artifact://internal/workspace_bundle/run_session/{run_session_id}/{bundle_id}
```

- Workers should not submit an `internal_ref` for new runtime artifact uploads. The control plane constructs the canonical ref from runtime job id, artifact id, and kind after authorization.
- Terminal results must use the canonical ref returned by the control plane.
- Terminal validation must accept canonical `artifact://internal/...` refs and verify they point to binding rows for the same runtime job.
- Existing `artifact://codex-runtime-jobs/...` refs may be read through a migration adapter only for already-written records. The adapter supports metadata lookup and terminal validation for old rows, but not byte download through `InternalArtifactStore.getObject` unless the row has been backfilled.
- No new runtime-job artifact write may emit the old namespace after Wave 1 lands.

### Pending Workspace Bundles

Wave 1 includes pending workspace bundle storage for new writes.

Current pending bundle records store `archive_bytes_base64` and a pending artifact ref in `codex_pending_workspace_bundles`. After Wave 1:

- new pending bundle creation writes the archive bytes into `InternalArtifactStore` as `kind = workspace_bundle`;
- `codex_pending_workspace_bundles.archive_bytes_base64` becomes nullable and legacy-only;
- `codex_pending_workspace_bundles.pending_artifact_ref` stores the canonical internal ref;
- `codex_pending_workspace_bundles` stores `internal_artifact_object_id` or `internal_artifact_ref`, digest, manifest digest, size, and acquisition metadata;
- `workspace_acquisition_json.archive_ref` must equal the canonical `artifact://internal/workspace_bundle/run_session/{run_session_id}/{bundle_id}` ref for new rows;
- runtime-job bundle binding creates or replays the `codex_runtime_job_artifacts` usage row pointing at the same `InternalArtifactObject`;
- runtime-job workspace download reads bytes through the internal store by canonical ref;
- old pending bundle rows that still have DB-stored bytes remain readable only through a migration path, and no new rows may store archive bytes as the canonical source.

Pending bundle replay and drift rules:

- replay is keyed by existing `bundle_id`;
- replay succeeds only when archive digest, manifest digest, size, workspace acquisition digest, run session id, execution package id, run-worker lease id, and canonical pending artifact ref match;
- replay with different archive bytes, manifest, acquisition JSON, lease, or canonical ref is rejected as `workspace_bundle_idempotency_drift`;
- runtime-job binding must lock the pending row and create a `codex_runtime_job_artifacts` usage row that points at the same internal artifact object;
- binding replay succeeds only when the existing usage row references the same runtime job, bundle id, digest, manifest digest, and internal artifact ref.

Legacy pending-bundle migration contract:

- the DB-byte read path is read-only and exists only for rows created before Wave 1 lands;
- access is trusted-worker/control-plane only and requires the same runtime job, run session, run-worker lease, and digest checks as the InternalArtifactStore read path;
- reads must recompute archive digest and manifest digest before returning bytes;
- the migration path must not expose bytes, refs, or local/storage details through browser/product APIs;
- no new `archive_bytes_base64` value may be written as the canonical source after Wave 1;
- old rows must be backfilled to InternalArtifactStore or tombstoned before Wave 4 snapshot packaging starts;
- the runbook must document the removal gate so the migration path cannot become permanent baggage.

## Trusted Worker APIs

Wave 1 must add exact internal artifact endpoints and update the existing runtime-job wrapper route.

Store endpoints:

```text
POST /internal/artifacts:upload
GET /internal/artifacts?ref_base64url={base64url(canonical_ref)}
HEAD /internal/artifacts?ref_base64url={base64url(canonical_ref)}
DELETE /internal/artifacts
```

Runtime-job-specific upload endpoints may remain as domain wrappers, but they must call the internal store rather than write directly to runtime artifact tables.

Store upload DTO:

```ts
type UploadInternalArtifactMetadata = {
  schema_version: 'internal_artifact_upload.v1';
  owner_type: InternalArtifactOwnerType;
  owner_id: string;
  kind: InternalArtifactKind;
  visibility: InternalArtifactVisibility;
  content_type: string;
  declared_size_bytes: string;
  declared_artifact_digest: string;
  idempotency_key: string;
  metadata_json: Record<string, unknown>;
};
```

Store upload transport:

- `multipart/form-data` with parts `metadata` and `file`; or
- `application/octet-stream` body with metadata in headers prefixed `x-forgeloop-artifact-*`.

Store upload response:

```ts
type UploadInternalArtifactResponse = {
  artifact: {
    id: string;
    ref: string;
    kind: InternalArtifactKind;
    content_type: string;
    digest: string;
    size_bytes: string;
    visibility: InternalArtifactVisibility;
    owner_type: InternalArtifactOwnerType;
    owner_id: string;
    created_at: string;
  };
};
```

Store stat/download/delete contracts:

```ts
type InternalArtifactRefRequest = {
  schema_version: 'internal_artifact_ref_request.v1';
  ref_base64url: string;
  requester_type: 'codex_worker' | 'system' | 'admin';
  requester_id: string;
  nonce?: string;
  nonce_timestamp?: string;
  body_digest?: string;
};

type InternalArtifactStatResponse = {
  artifact: {
    id: string;
    ref: string;
    kind: InternalArtifactKind;
    content_type: string;
    digest: string;
    size_bytes: string;
    visibility: InternalArtifactVisibility;
    owner_type: InternalArtifactOwnerType;
    owner_id: string;
    created_at: string;
    deleted_at?: string;
  };
};

type DeleteInternalArtifactResponse = {
  artifact: InternalArtifactStatResponse['artifact'];
  deleted: true;
};
```

`InternalArtifactStatResponse` is the trusted server/client abstraction produced by decoding `HEAD` response headers or repository metadata. It is not a `HEAD` JSON response body.

For `HEAD` and `GET`, the wire request carrier is:

- `ref_base64url` in the query string;
- authenticated requester identity from the worker/admin auth context;
- optional replay fields in headers: `x-forgeloop-artifact-requester-type`, `x-forgeloop-artifact-requester-id`, `x-forgeloop-artifact-nonce`, `x-forgeloop-artifact-nonce-timestamp`, and `x-forgeloop-artifact-body-digest`;
- no JSON body.

For `DELETE`, the wire request carrier is a JSON `InternalArtifactRefRequest` body. The same authenticated worker/admin context is still required, and body fields must match that auth context.

`HEAD /internal/artifacts` returns no body and must include:

```text
x-forgeloop-artifact-ref: {canonical_ref}
x-forgeloop-artifact-kind: {kind}
x-forgeloop-artifact-digest: sha256:...
x-forgeloop-artifact-size-bytes: {decimal string}
content-type: {content_type}
content-length: {size bytes when available}
```

`GET /internal/artifacts` returns the stored bytes and the same digest, size, ref, and kind headers. `DELETE /internal/artifacts` tombstones the object metadata and returns `DeleteInternalArtifactResponse`.

Stat, download, and delete responses must not include `storage_key`, local paths, bucket paths, filesystem errors, or backend-specific locations.

Runtime-job wrapper upload DTO:

```ts
type CreateCodexRuntimeJobArtifactUpload = {
  schema_version: 'codex_runtime_job_artifact_upload.v2';
  worker_session_token: string;
  nonce: string;
  nonce_timestamp: string;
  body_digest: string;
  artifact_idempotency_key: string;
  kind: string;
  name: string;
  content_type: string;
  digest: string;
  size_bytes: string;
  metadata_json: Record<string, unknown>;
};
```

The existing route stays the domain wrapper:

```text
POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/artifacts
```

Its request must become multipart or octet-stream and include the bytes for every new artifact write. The current metadata-only JSON DTO must be rejected for new writes. This applies to:

- `generated_payload`;
- `generation_validation_report`;
- `startup_failure_evidence`;
- `cleanup_failure_evidence`;
- `run_execution_patch`;
- any future runtime-job artifact kind.

Transport rules:

- refs containing `/` are never carried as path params;
- `ref_base64url` is transport encoding only and must decode to the canonical ref string before validation;
- DELETE carries `ref_base64url` only inside the JSON `InternalArtifactRefRequest` body, then validates the decoded ref and requires requester fields to match the authenticated context;
- POST uploads bytes with `multipart/form-data` for large objects or `application/octet-stream` raw body with metadata headers;
- JSON/base64 upload is allowed only for small JSON runtime artifacts under the existing inline artifact limit, and the decoded bytes are still stored as bytes;
- metadata-only uploads are rejected for new writes;
- runtime artifact helper methods must include the same payload bytes used to compute declared digest;
- the service recomputes `artifact_byte_digest = sha256(uploaded_bytes)` and requires it to equal the declared artifact digest;
- `request_digest` covers the canonical request payload defined in the data model section;
- worker replay protection signs the HTTP upload request digest, which includes method, path, ref transport encoding or upload metadata, declared artifact digest, declared size, idempotency key, nonce, and timestamp;
- the HTTP upload request digest is distinct from the stored artifact byte digest;
- response projection returns kind, name, content type, digest, size, and canonical `internal_ref`, but not `storage_key` or local paths.

Runtime consumers that must migrate in Wave 1:

- `CodexRuntimeService.createRuntimeJobArtifact` must compute canonical `artifact://internal/...` refs and store bytes through InternalArtifactStore.
- `createCodexRuntimeJobArtifactSchema` and worker client `uploadRuntimeJobArtifact` must carry bytes for all new writes.
- `jsonRuntimeJobArtifactUpload` must provide JSON bytes, not only metadata.
- run-execution patch upload must send patch bytes to the control plane; the local patch helper must stop emitting old-prefix refs as canonical output.
- automation-daemon generation result handling must stop checking only the `artifact://codex-runtime-jobs/{runtimeJobId}/artifacts/` prefix and must use the internal runtime artifact binding validator.
- domain runtime public-safety validation must accept canonical internal refs only through an internal-runtime protocol validator, not by widening public `ArtifactRef` or `PublicArtifactRef`.
- run-worker terminal projection must preserve internal refs only in trusted runtime results and avoid exposing them to normal product DTOs.
- old-prefix acceptance is allowed only in the migration adapter for records created before Wave 1; in-flight old runtime jobs may terminalize through the adapter, but no post-Wave-1 upload may persist an old-prefix ref.

Generated payload resolution:

- `generated_payload_ref.v1` must resolve by loading bytes from the bound `InternalArtifactObject`;
- resolution verifies runtime-job binding kind `generated_payload`, backing object kind `codex_runtime_job_artifact`, content type `application/json`, digest, and canonical internal ref;
- JSON is parsed from stored bytes and its canonical digest must equal `generated_payload_digest`;
- `metadata_json.generated_payload` is no longer canonical and must not be required for applying generated payloads;
- metadata may keep summary/index fields only.

Access rules:

- trusted worker requests require current worker session proof, nonce, and replay protection;
- domain wrappers must verify the worker is allowed to write the owner object;
- direct internal store endpoints require explicit owner authorization or are admin/operator only;
- downloads require the caller to prove access to the owner object or a trusted worker workload that references it;
- normal browser/product APIs must not expose these endpoints.

## Metadata Safety

Artifact metadata is not arbitrary public JSON.

Rules:

- metadata must be JSON object only;
- metadata must pass product-safe value validation unless it is stored behind `visibility = internal` and never projected to product DTOs;
- metadata must not contain raw prompts, auth payloads, tokens, local host paths, container ids, or raw command output;
- metadata may contain digests, schema versions, object ids, byte counts, artifact kind, and public-safe reason codes.

For Codex session snapshots, future waves may store detailed manifest metadata in the artifact bytes, but normal product DTOs must receive only product-safe continuity status.

## Error Handling

Store errors must be explicit and safe:

| Condition | Result |
| --- | --- |
| ref parse failure | reject with `internal_artifact_ref_invalid` |
| path traversal or escaped root | reject with `internal_artifact_path_denied` |
| digest mismatch | reject with `internal_artifact_digest_mismatch` |
| size over limit | reject with `internal_artifact_size_exceeded` |
| unsupported content type | reject with `internal_artifact_content_type_denied` |
| owner authorization failure | reject with `internal_artifact_owner_denied` |
| idempotency replay with different request | reject with `internal_artifact_idempotency_drift` |
| object missing or tombstoned | reject with `internal_artifact_not_found` |
| filesystem write failure | reject with `internal_artifact_write_failed` |

Public-safe callers receive codes and high-level summaries only. Server logs may include refs and digests, but not local absolute paths unless the log is operator-only.

## Implementation Boundaries

Wave 1 must touch:

- contracts/domain types for internal artifact refs and metadata;
- DB schema/repository for `internal_artifact_objects`;
- local filesystem ArtifactStore implementation;
- trusted control-plane API/client methods;
- runtime-job artifact intake adapter;
- pending workspace bundle storage and download path;
- internal runtime artifact ref validator for terminal/internal protocols;
- tests for store safety and runtime-job compatibility.

Wave 1 must not touch:

- CodexSession or CodexSessionSnapshot tables;
- worker `CODEX_HOME` layout;
- app-server resume;
- Plan Item UI;
- public Attachment API;
- public artifact schemas except to ensure they do not accept internal refs.

## Verification Strategy

Required tests:

- ref parser accepts valid internal refs and rejects path traversal, scheme nesting, encoded separators, query strings, fragments, backslashes, and empty segments;
- local backend writes bytes only under root and rejects escaped paths;
- digest mismatch rejects and leaves no committed object;
- idempotent put with same owner/ref/digest replays safely;
- idempotent put with same idempotency key but different digest rejects;
- delete tombstones metadata and prevents future reads by ref;
- runtime-job artifact intake writes through InternalArtifactStore and preserves current worker/job authorization checks;
- runtime-job terminal validation accepts canonical `artifact://internal/...` refs only for artifacts bound to the same runtime job;
- old `artifact://codex-runtime-jobs/...` rows remain terminal-valid through migration adapter but cannot be newly written;
- new terminal results using `artifact://internal/...` refs are accepted end-to-end by worker, control plane, automation-daemon, generated-payload application, and run-execution result handling;
- post-Wave-1 attempts to upload or persist old-prefix runtime artifact refs are rejected;
- pending workspace bundle creation stores bytes in InternalArtifactStore, and runtime-job workspace download reads through the store;
- pending workspace bundle replay detects acquisition or archive drift;
- legacy pending bundle DB-byte rows remain trusted-worker/control-plane-only, verify digest on read, and have tests proving they are not exposed through product DTOs or normal user APIs;
- generated payload refs load JSON from InternalArtifactStore bytes, not from `metadata_json.generated_payload`;
- public product DTO tests prove internal refs and storage keys are not exposed;
- Attachment API tests or contract tests prove session/internal artifacts are not product Attachments;
- existing runtime terminalization tests still resolve generated payload artifacts.

Required commands before completion:

- `pnpm test`;
- `pnpm build`;
- `git diff --check`;
- targeted no-baggage scan for local path leakage and product Attachment misuse.

## Acceptance Criteria

Wave 1 is complete when:

- there is one InternalArtifactStore interface with a local filesystem backend;
- internal artifact metadata is persisted in a repository/table;
- all new stored refs use the canonical `artifact://internal/...` namespace;
- no persisted internal object exposes local absolute paths through product DTOs;
- trusted workers can upload, stat, download, and delete internal objects by ref with authorization;
- `CodexRuntimeJobArtifact` no longer acts as an independent storage authority;
- every runtime artifact upload path carries bytes and rejects metadata-only new writes;
- generated payload resolution reads byte-backed artifacts from InternalArtifactStore;
- new pending workspace bundle rows no longer store archive bytes as the canonical source;
- product Attachments are not used for internal runtime/session artifacts;
- tests cover path traversal, digest mismatch, visibility fences, idempotency drift, and runtime-job artifact compatibility.

## Implementation Planning Decisions And Questions

- Wave 1 will not backfill old `artifact://codex-runtime-jobs/...` rows. It provides a temporary read-only migration adapter for metadata lookup and terminal validation of existing rows only. The canonical write path is not open: new writes must emit `artifact://internal/...`. The adapter must have an explicit removal gate before Wave 4 snapshot packaging begins.
- Wave 1 will not immediately backfill old pending workspace bundle DB-byte rows. It provides a trusted-worker/control-plane-only read migration path with digest verification for existing rows only. Those rows must be backfilled to InternalArtifactStore or tombstoned before Wave 4 snapshot packaging begins.
- Whether content-addressed object bytes should be garbage-collected in Wave 1 or only tombstoned until the operations wave. The safer default is tombstone-only.
- Whether the first backend stores JSON metadata sidecars on disk in addition to DB metadata. The DB row is authoritative either way.
