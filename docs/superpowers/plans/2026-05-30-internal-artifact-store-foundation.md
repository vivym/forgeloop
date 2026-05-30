# Internal Artifact Store Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Wave 1's private byte-backed InternalArtifactStore and migrate runtime-job artifacts plus pending workspace bundles onto canonical `artifact://internal/...` refs.

**Architecture:** Add domain-level internal artifact contracts, DB metadata ownership, and a reusable local filesystem object store under `FORGELOOP_ARTIFACT_STORE_ROOT`. Keep product Attachments and public artifact schemas separate, while changing Codex runtime wrappers and worker clients to upload bytes and bind domain records to stored internal objects.

**Tech Stack:** TypeScript, pnpm, Vitest, NestJS, Drizzle ORM, Node.js filesystem streams, existing ForgeLoop domain/db/control-plane/runtime packages.

---

## Scope Check

This plan implements only `docs/superpowers/specs/2026-05-30-internal-artifact-store-foundation-design.md`.

In scope:

- Internal artifact ref parser and domain contracts.
- `internal_artifact_objects` metadata table and repository operations.
- Local filesystem byte store using content-addressed `sha256` object paths.
- Trusted internal store API for upload/stat/download/delete.
- Existing Codex runtime job artifact wrapper migrated from metadata-only JSON to byte-backed upload.
- Existing pending workspace bundle path migrated from DB-stored archive bytes to InternalArtifactStore bytes for new rows.
- Generated payload resolution migrated from `metadata_json.generated_payload` to stored artifact bytes.
- Migration adapter for old `artifact://codex-runtime-jobs/...` records only where the spec allows read-only terminal validation of pre-Wave-1 rows.

Out of scope:

- CodexSession and CodexSessionSnapshot tables.
- `CODEX_HOME` packaging or restore.
- App-server session resume.
- Plan Item workflow UI.
- Public Attachment API changes beyond tests proving it is not reused.
- S3/R2/GCS/MinIO backends.

## File Structure

### Domain Contracts

- Create `packages/domain/src/internal-artifacts.ts`
  - Owns `InternalArtifactKind`, `InternalArtifactOwnerType`, `InternalArtifactVisibility`, `InternalArtifactObject`, canonical ref builder/parser, base64url ref transport helpers, error-code helpers, and public-schema separation helpers.
- Modify `packages/domain/src/codex-runtime.ts`
  - Uses the new internal runtime artifact ref validator for terminal runtime artifact refs without widening public `ArtifactRef`.
  - Keeps legacy `artifact://codex-runtime-jobs/...` acceptance only behind an explicit migration helper used by repository terminal validation.
- Modify `packages/domain/src/index.ts`
  - Exports internal artifact contracts.
- Test `tests/domain/internal-artifacts.test.ts`
  - Covers ref parse/build, invalid path segments, base64url transport, public schema separation, and legacy-runtime-ref migration helper.
- Modify `tests/domain/codex-runtime.test.ts`
  - Covers terminal result validation for canonical internal refs and rejection of old-prefix refs outside migration helper.

### DB Schema And Repository

- Create `packages/db/src/schema/internal-artifact.ts`
  - Defines `internal_artifact_objects`.
- Modify `packages/db/src/schema/index.ts`
  - Exports the new schema file.
- Modify `packages/db/src/index.ts`
  - Exports repository/store types from new files.
- Modify `packages/db/src/reset.ts`
  - Adds `internal_artifact_objects` before runtime binding tables in `resettableTables`.
- Modify `packages/db/src/schema/codex-runtime.ts`
  - Adds nullable `internalArtifactObjectId` to `codex_runtime_job_artifacts` so pre-Wave-1 rows remain readable.
  - Adds nullable `internalArtifactObjectId` to `codex_pending_workspace_bundles` so legacy DB-byte rows remain readable.
  - Makes `codex_pending_workspace_bundles.archiveBytesBase64` nullable and legacy-only.
  - Changes internal object sizes to DB 64-bit integer while preserving runtime binding `sizeBytes` as bounded integer.
- Modify `packages/db/src/repositories/delivery-repository.ts`
  - Adds repository interfaces for internal artifact metadata create/replay, stat, tombstone, lookup-by-ref, and lookup-by-id.
  - Adds internal artifact IDs/refs to runtime artifact and pending bundle inputs.
- Modify `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Implements the new repository contract and in-memory idempotency/ref constraints.
- Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Implements the new repository contract with DB constraints and advisory locks.
- Test `tests/db/schema.test.ts`
  - Asserts table, required columns, indexes, and reset ordering.
- Test `tests/db/reset.test.ts`
  - Asserts reset ordering includes `internal_artifact_objects`.
- Test `tests/db/internal-artifact-repository.test.ts`
  - Contract tests for in-memory repository; mirror critical cases in drizzle repository where existing DB test patterns allow it.
- Modify `tests/db/codex-runtime-repository.test.ts`
  - Runtime artifact binding and pending bundle tests now assert canonical internal refs and object IDs.
- Modify `tests/db/codex-runtime-drizzle-concurrency.test.ts`
  - Updates concurrent pending bundle creation to assert one internal object and one bound usage row.

### Reusable Local Store

- Create `packages/db/src/internal-artifacts/local-internal-artifact-store.ts`
  - Reusable local filesystem implementation because both control-plane API and run-worker package need the same store.
  - Uses `DeliveryRepository` metadata methods and Node fs primitives.
- Create `packages/db/src/internal-artifacts/types.ts`
  - Store input/output types that combine domain contracts with Node `Buffer`/stream carriers.
- Test `tests/db/local-internal-artifact-store.test.ts`
  - Covers digest verification, path traversal hardening, symlink denial, idempotent replay, tombstone behavior, and content-addressed byte reuse.

### Control-Plane API

- Create `apps/control-plane-api/src/modules/internal-artifacts/internal-artifacts.dto.ts`
  - Zod schemas for upload metadata, ref requests, stat response, delete response, and header/query parsing.
- Create `apps/control-plane-api/src/modules/internal-artifacts/internal-artifacts.service.ts`
  - Thin application service over `LocalInternalArtifactStore`.
- Create `apps/control-plane-api/src/modules/internal-artifacts/internal-artifacts.controller.ts`
  - Adds `POST /internal/artifacts:upload`, `GET /internal/artifacts`, `HEAD /internal/artifacts`, and `DELETE /internal/artifacts`.
- Create `apps/control-plane-api/src/modules/internal-artifacts/internal-artifacts.module.ts`
  - Provides `InternalArtifactsService`.
- Modify `apps/control-plane-api/src/app.module.ts`
  - Imports `InternalArtifactsModule`.
- Modify `apps/control-plane-api/src/modules/core/control-plane-tokens.ts`
  - Adds an injection token for the artifact store root if the implementation needs explicit provider wiring.
- Modify `apps/control-plane-api/src/modules/core/control-plane-core.module.ts`
  - Reads `FORGELOOP_ARTIFACT_STORE_ROOT`; tests may default to a temp root.
- Test `tests/api/internal-artifacts-api.test.ts`
  - API coverage for upload/stat/download/delete carriers, headers, auth, and no storage key leakage.

### Runtime Job Artifact Migration

- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts`
  - Replaces metadata-only artifact schema with v2 metadata schema plus byte carrier extraction.
- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts`
  - Parses runtime artifact upload bytes with multipart or octet-stream transport.
  - Keeps existing route path `POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/artifacts`.
- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
  - Writes uploaded bytes through InternalArtifactStore before creating the runtime binding row.
  - Computes canonical `artifact://internal/codex_runtime_job_artifact/codex_runtime_job/{runtime_job_id}/{artifact_id}` refs.
  - Rejects metadata-only new writes.
  - Resolves workspace bundle downloads through the internal store.
- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.module.ts`
  - Imports/provides internal artifact store dependencies.
- Modify `tests/api/codex-runtime-control-plane.test.ts`
  - End-to-end runtime artifact upload, terminalization, generated payload, and workspace bundle checks.
- Modify `tests/db/codex-runtime-repository.test.ts`
  - Repository-level binding and terminal validation checks.

### Worker And Run-Worker Clients

- Modify `packages/codex-worker-runtime/src/runtime-job-artifacts.ts`
  - `RuntimeJobArtifactUploadInput` carries bytes in addition to metadata.
  - `jsonRuntimeJobArtifactUpload` returns canonical JSON bytes and digest derived from the bytes.
- Modify `packages/codex-worker-runtime/src/control-plane-client.ts`
  - Sends artifact bytes using `application/octet-stream` plus metadata/proof headers or multipart with `metadata` and `file`.
  - Keeps existing JSON worker proof for non-artifact routes.
- Modify `packages/codex-worker-runtime/src/remote-worker-client.ts`
  - Uploads generated payloads, validation reports, failure evidence, run execution patches, and future runtime artifacts with bytes.
  - Uses control-plane returned canonical internal refs in terminal results.
- Modify `packages/codex-worker-runtime/src/workspace-bundle.ts`
  - Removes old-prefix patch helper canonical output; local patch helper returns bytes/digest/name only.
- Modify `packages/run-worker/src/run-worker.ts`
  - Writes pending workspace bundle archives through `LocalInternalArtifactStore`.
  - Stores canonical internal archive refs in workspace acquisition JSON.
- Test `tests/codex-worker-runtime/control-plane-client.test.ts`
  - Asserts artifact upload request carries bytes, worker proof, and digest.
- Test `tests/codex-worker-runtime/remote-worker-client.test.ts`
  - Asserts generated payloads, validation reports, failure evidence, and run execution patches upload bytes and use returned internal refs.
- Test `tests/codex-worker-runtime/workspace-bundle.test.ts`
  - Asserts patch helper no longer emits old-prefix refs.
- Modify `tests/run-worker/run-worker.test.ts`
  - Asserts pending workspace bundle creation stores bytes through the store and does not persist new DB archive bytes as canonical source.

### Consumer Migration And No-Baggage Gates

- Modify `apps/control-plane-api/src/modules/automation/product-generation-result.service.ts`
  - Resolves `generated_payload_ref.v1` by loading bytes from InternalArtifactStore via the runtime artifact binding row.
  - Ignores `metadata_json.generated_payload` as canonical source for new rows.
- Modify `apps/automation-daemon/src/generation-runtime.ts`
  - Stops checking only `artifact://codex-runtime-jobs/{runtimeJobId}/artifacts/`.
  - Uses domain/internal runtime artifact validation for canonical internal refs.
- Modify `tests/api/automation-daemon.integration.test.ts` or `tests/api/codex-runtime-control-plane.test.ts`
  - Covers generated-payload application from bytes, not metadata.
- Modify `tests/smoke/codex-runtime-no-baggage-gate.test.ts`
  - Adds guard coverage for old-prefix writes, metadata-only artifact uploads, storage key leakage, and product Attachment misuse.

## Implementation Rules

- Do not implement Codex session snapshots in this wave.
- Do not widen `packages/contracts/src/public-artifacts.ts`, public `ArtifactRef`, or product Attachments to accept `artifact://internal/...`.
- Do not return `storage_key`, local paths, bucket paths, or filesystem errors from product DTOs or internal API responses.
- Do not keep old-prefix refs as a new-write path. Old `artifact://codex-runtime-jobs/...` refs are allowed only in explicit migration tests.
- Do not store new pending workspace bundle archive bytes in `codex_pending_workspace_bundles.archive_bytes_base64` as the canonical source.
- Schema evolution for Wave 1 keeps `internal_artifact_object_id` nullable on existing runtime binding tables so pre-Wave-1 rows remain readable through the explicit migration adapters. Repository/service code must require non-null `internal_artifact_object_id` for every new runtime artifact or pending workspace bundle write after Wave 1 lands.
- Wave 1 does not backfill durable old rows. Existing rows retain their legacy refs/DB bytes until a later backfill-or-tombstone runbook before Wave 4.
- Keep all byte digests as `sha256:{64 lowercase hex}`.
- Keep API/store DTO `size_bytes` values as decimal strings. Runtime binding domain objects may continue to expose bounded `size_bytes: number` where existing runtime code expects it.

## Task 1: Domain Internal Artifact Contracts

**Files:**
- Create: `packages/domain/src/internal-artifacts.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/codex-runtime.ts`
- Create: `tests/domain/internal-artifacts.test.ts`
- Modify: `tests/domain/codex-runtime.test.ts`

- [ ] **Step 1: Write failing ref contract tests**

Add `tests/domain/internal-artifacts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildInternalArtifactRef,
  decodeInternalArtifactRefBase64Url,
  encodeInternalArtifactRefBase64Url,
  isInternalArtifactRefString,
  parseInternalArtifactRef,
} from '@forgeloop/domain';

describe('internal artifact refs', () => {
  it('builds and parses canonical internal artifact refs', () => {
    const ref = buildInternalArtifactRef({
      kind: 'codex_runtime_job_artifact',
      owner_type: 'codex_runtime_job',
      owner_id: 'runtime-job-1',
      artifact_id: 'artifact-1',
    });

    expect(ref).toBe('artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/artifact-1');
    expect(parseInternalArtifactRef(ref)).toEqual({
      kind: 'codex_runtime_job_artifact',
      owner_type: 'codex_runtime_job',
      owner_id: 'runtime-job-1',
      artifact_id: 'artifact-1',
    });
    expect(isInternalArtifactRefString(ref)).toBe(true);
  });

  it.each([
    'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1',
    'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/../x',
    'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/%2F',
    'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/artifact-1?x=1',
    'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/artifact-1#x',
    'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/CAPS',
    '/tmp/local-file',
  ])('rejects unsafe ref %s', (ref) => {
    expect(() => parseInternalArtifactRef(ref)).toThrow();
    expect(isInternalArtifactRefString(ref)).toBe(false);
  });

  it('round-trips refs through base64url transport encoding', () => {
    const ref = 'artifact://internal/workspace_bundle/run_session/run-session-1/bundle-1';
    expect(decodeInternalArtifactRefBase64Url(encodeInternalArtifactRefBase64Url(ref))).toBe(ref);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/domain/internal-artifacts.test.ts
```

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Implement domain contracts**

Create `packages/domain/src/internal-artifacts.ts`:

```ts
export const internalArtifactKinds = [
  'codex_session_snapshot',
  'codex_runtime_job_artifact',
  'workspace_bundle',
  'generated_payload',
  'execution_patch',
  'review_packet',
  'logs',
  'raw_metadata',
] as const;

export type InternalArtifactKind = (typeof internalArtifactKinds)[number];

export const internalArtifactOwnerTypes = [
  'codex_runtime_job',
  'codex_session',
  'run_session',
  'execution_package',
  'review_packet',
  'automation_action_run',
  'system',
] as const;

export type InternalArtifactOwnerType = (typeof internalArtifactOwnerTypes)[number];
export type InternalArtifactVisibility = 'internal' | 'private';

export interface InternalArtifactObject {
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
}

const segmentPattern = /^[a-z0-9_-]+$/;
const kindSet = new Set<string>(internalArtifactKinds);
const ownerTypeSet = new Set<string>(internalArtifactOwnerTypes);

export const buildInternalArtifactRef = (input: {
  kind: InternalArtifactKind;
  owner_type: InternalArtifactOwnerType;
  owner_id: string;
  artifact_id: string;
}): string => {
  for (const [label, value] of Object.entries(input)) {
    if (!segmentPattern.test(value)) {
      throw new Error(`internal_artifact_ref_invalid:${label}`);
    }
  }
  return `artifact://internal/${input.kind}/${input.owner_type}/${input.owner_id}/${input.artifact_id}`;
};

export const parseInternalArtifactRef = (ref: string) => {
  if (!ref.startsWith('artifact://internal/') || ref.includes('\\') || ref.includes('?') || ref.includes('#')) {
    throw new Error('internal_artifact_ref_invalid');
  }
  const segments = ref.slice('artifact://internal/'.length).split('/');
  if (segments.length !== 4 || segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error('internal_artifact_ref_invalid');
  }
  const [kind, ownerType, ownerId, artifactId] = segments;
  if (
    kind === undefined ||
    ownerType === undefined ||
    ownerId === undefined ||
    artifactId === undefined ||
    !kindSet.has(kind) ||
    !ownerTypeSet.has(ownerType) ||
    !segments.every((segment) => segmentPattern.test(segment))
  ) {
    throw new Error('internal_artifact_ref_invalid');
  }
  return {
    kind: kind as InternalArtifactKind,
    owner_type: ownerType as InternalArtifactOwnerType,
    owner_id: ownerId,
    artifact_id: artifactId,
  };
};

export const isInternalArtifactRefString = (ref: string): boolean => {
  try {
    parseInternalArtifactRef(ref);
    return true;
  } catch {
    return false;
  }
};

export const encodeInternalArtifactRefBase64Url = (ref: string): string => Buffer.from(ref, 'utf8').toString('base64url');
export const decodeInternalArtifactRefBase64Url = (encoded: string): string => Buffer.from(encoded, 'base64url').toString('utf8');
```

Add `export * from './internal-artifacts';` to `packages/domain/src/index.ts`.

- [ ] **Step 4: Add runtime terminal ref tests**

In `tests/domain/codex-runtime.test.ts`, add tests near existing terminal artifact validation:

```ts
it('accepts canonical internal runtime artifact refs in terminal artifacts', () => {
  expect(() =>
    validateCodexRuntimeJobTerminalResult({
      task_kind: 'run_execution',
      output_schema_version: 'codex_run_execution_result.v1',
      execution_package_id: 'execution-package-1',
      execution_package_version: 1,
      run_session_id: 'run-session-1',
      workspace_bundle_digest: digestA,
      workspace_bundle_manifest_digest: digestB,
      mounted_task_workspace_digest: digestC,
      changed_files: [],
      check_results: [],
      execution_artifacts: [
        {
          kind: 'logs',
          name: 'log.txt',
          content_type: 'text/plain',
          digest: digestA,
          internal_ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/artifact-1',
        },
      ],
      public_summary: 'ok',
    }),
  ).not.toThrow();
});

it('does not accept old runtime artifact refs in normal terminal validation', () => {
  expectDomainErrorCode(
    () =>
      validateCodexRuntimeJobTerminalResult({
        task_kind: 'run_execution',
        output_schema_version: 'codex_run_execution_result.v1',
        execution_package_id: 'execution-package-1',
        execution_package_version: 1,
        run_session_id: 'run-session-1',
        workspace_bundle_digest: digestA,
        workspace_bundle_manifest_digest: digestB,
        mounted_task_workspace_digest: digestC,
        changed_files: [],
        check_results: [],
        execution_artifacts: [
          {
            kind: 'logs',
            name: 'log.txt',
            content_type: 'text/plain',
            digest: digestA,
            internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/artifact-1',
          },
        ],
        public_summary: 'ok',
      }),
    'codex_runtime_public_payload_unsafe',
  );
});
```

- [ ] **Step 5: Update runtime artifact ref validation**

In `packages/domain/src/codex-runtime.ts`, import `isInternalArtifactRefString`, and in `requireCodexRuntimeArtifact`, require `input.internal_ref` to pass `isInternalArtifactRefString(input.internal_ref)` when present. Add a separate exported helper for repository migration checks:

```ts
export const isLegacyCodexRuntimeJobArtifactRefString = (ref: string): boolean =>
  /^artifact:\/\/codex-runtime-jobs\/[^/]+\/artifacts\/[^/]+$/.test(ref);
```

Do not use the legacy helper in public terminal result validation.

- [ ] **Step 6: Run focused domain tests**

Run:

```bash
pnpm vitest run tests/domain/internal-artifacts.test.ts tests/domain/codex-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit domain contracts**

```bash
git add packages/domain/src/internal-artifacts.ts packages/domain/src/index.ts packages/domain/src/codex-runtime.ts tests/domain/internal-artifacts.test.ts tests/domain/codex-runtime.test.ts
git commit -m "feat: add internal artifact domain contracts"
```

## Task 2: DB Schema And Metadata Repository

**Files:**
- Create: `packages/db/src/schema/internal-artifact.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/reset.ts`
- Modify: `packages/db/src/schema/codex-runtime.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `tests/db/schema.test.ts`
- Modify: `tests/db/reset.test.ts`
- Create: `tests/db/internal-artifact-repository.test.ts`

- [ ] **Step 1: Write failing schema tests**

In `tests/db/schema.test.ts`, add `internal_artifact_objects` to `requiredTables` and assert core columns:

```ts
it('defines internal artifact objects with non-public storage metadata', () => {
  const columns = getTableColumns(internal_artifact_objects);
  expect(Object.keys(columns)).toEqual(expect.arrayContaining([
    'id',
    'artifactId',
    'ref',
    'storageKey',
    'kind',
    'contentType',
    'sizeBytes',
    'digest',
    'visibility',
    'ownerType',
    'ownerId',
    'idempotencyKey',
    'requestDigest',
    'metadataJson',
    'createdByActorType',
    'createdByActorId',
    'createdAt',
    'deletedAt',
  ]));
});
```

In `tests/db/reset.test.ts`, assert:

```ts
expect(resettableTables.indexOf('internal_artifact_objects')).toBeLessThan(
  resettableTables.indexOf('codex_runtime_job_artifacts'),
);
```

- [ ] **Step 2: Run schema tests to verify failure**

Run:

```bash
pnpm vitest run tests/db/schema.test.ts tests/db/reset.test.ts
```

Expected: FAIL because the table does not exist.

- [ ] **Step 3: Add schema**

Create `packages/db/src/schema/internal-artifact.ts` using Drizzle pg-core. Use `bigint('size_bytes', { mode: 'bigint' })` for DB storage:

```ts
import { bigint, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { InternalArtifactKind, InternalArtifactOwnerType, InternalArtifactVisibility, InternalArtifactObject } from '@forgeloop/domain';

import { timestampColumn } from './_shared';

export const internal_artifact_objects = pgTable(
  'internal_artifact_objects',
  {
    id: uuid('id').primaryKey(),
    artifactId: text('artifact_id').notNull(),
    ref: text('ref').notNull(),
    storageKey: text('storage_key').notNull(),
    kind: text('kind').$type<InternalArtifactKind>().notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    digest: text('digest').notNull(),
    visibility: text('visibility').$type<InternalArtifactVisibility>().notNull(),
    ownerType: text('owner_type').$type<InternalArtifactOwnerType>().notNull(),
    ownerId: text('owner_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestDigest: text('request_digest').notNull(),
    metadataJson: jsonb('metadata_json').$type<InternalArtifactObject['metadata_json']>().notNull(),
    createdByActorType: text('created_by_actor_type').$type<InternalArtifactObject['created_by_actor_type']>().notNull(),
    createdByActorId: text('created_by_actor_id').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
    deletedAt: timestampColumn('deleted_at'),
  },
  (table) => [
    uniqueIndex('internal_artifact_objects_ref_idx').on(table.ref),
    uniqueIndex('internal_artifact_objects_owner_idempotency_idx').on(table.ownerType, table.ownerId, table.idempotencyKey),
    uniqueIndex('internal_artifact_objects_owner_kind_artifact_idx').on(table.ownerType, table.ownerId, table.kind, table.artifactId),
    index('internal_artifact_objects_owner_kind_created_idx').on(table.ownerType, table.ownerId, table.kind, table.createdAt),
    index('internal_artifact_objects_storage_key_idx').on(table.storageKey),
    index('internal_artifact_objects_digest_content_type_idx').on(table.digest, table.contentType),
  ],
);
```

Export from `packages/db/src/schema/index.ts`.

- [ ] **Step 4: Update runtime schema**

In `packages/db/src/schema/codex-runtime.ts`:

- import `internal_artifact_objects`;
- add nullable `internalArtifactObjectId: uuid('internal_artifact_object_id').references(() => internal_artifact_objects.id)` to `codex_runtime_job_artifacts`;
- add nullable `internalArtifactObjectId: uuid('internal_artifact_object_id').references(() => internal_artifact_objects.id)` to `codex_pending_workspace_bundles`;
- change `archiveBytesBase64: text('archive_bytes_base64')` without `.notNull()`.

The columns are nullable only for migration. All new repository/service write paths introduced by this plan must require `internal_artifact_object_id` and must reject missing object ids for post-Wave-1 writes.

- [ ] **Step 5: Write failing repository contract tests**

Create `tests/db/internal-artifact-repository.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { codexCanonicalDigest } from '@forgeloop/domain';
import { InMemoryDeliveryRepository } from '../../packages/db/src/index';

const now = '2026-05-30T00:00:00.000Z';
const bytesDigest = 'sha256:' + 'a'.repeat(64);

describe('Internal artifact repository', () => {
  it('creates and replays internal artifact metadata by owner idempotency key', async () => {
    const repository = new InMemoryDeliveryRepository();
    const input = {
      id: '11111111-1111-4111-8111-111111111111',
      artifact_id: 'artifact-1',
      ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/artifact-1',
      storage_key: 'objects/sha256/aa/' + 'a'.repeat(64),
      kind: 'codex_runtime_job_artifact' as const,
      content_type: 'application/json',
      size_bytes: '12',
      digest: bytesDigest,
      visibility: 'internal' as const,
      owner_type: 'codex_runtime_job' as const,
      owner_id: 'runtime-job-1',
      idempotency_key: 'idem-1',
      request_digest: codexCanonicalDigest({ request: 'same' }),
      metadata_json: { schema_version: 'test.v1' },
      created_by_actor_type: 'codex_worker' as const,
      created_by_actor_id: 'worker-1',
      created_at: now,
    };

    await expect(repository.createOrReplayInternalArtifactObject(input)).resolves.toMatchObject({
      ref: input.ref,
      size_bytes: '12',
    });
    await expect(repository.createOrReplayInternalArtifactObject(input)).resolves.toMatchObject({
      ref: input.ref,
      size_bytes: '12',
    });
  });

  it('rejects idempotency drift and ref conflicts', async () => {
    const repository = new InMemoryDeliveryRepository();
    const base = {
      id: '11111111-1111-4111-8111-111111111111',
      artifact_id: 'artifact-1',
      ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/artifact-1',
      storage_key: 'objects/sha256/aa/' + 'a'.repeat(64),
      kind: 'codex_runtime_job_artifact' as const,
      content_type: 'application/json',
      size_bytes: '12',
      digest: bytesDigest,
      visibility: 'internal' as const,
      owner_type: 'codex_runtime_job' as const,
      owner_id: 'runtime-job-1',
      idempotency_key: 'idem-1',
      request_digest: codexCanonicalDigest({ request: 'same' }),
      metadata_json: {},
      created_by_actor_type: 'codex_worker' as const,
      created_by_actor_id: 'worker-1',
      created_at: now,
    };
    await repository.createOrReplayInternalArtifactObject(base);
    await expect(repository.createOrReplayInternalArtifactObject({ ...base, digest: 'sha256:' + 'b'.repeat(64) })).rejects.toThrow();
    await expect(repository.createOrReplayInternalArtifactObject({ ...base, idempotency_key: 'idem-2' })).rejects.toThrow();
  });
});
```

- [ ] **Step 6: Run repository tests to verify failure**

Run:

```bash
pnpm vitest run tests/db/internal-artifact-repository.test.ts
```

Expected: FAIL because repository methods do not exist.

- [ ] **Step 7: Add repository interfaces**

In `packages/db/src/repositories/delivery-repository.ts`, add:

```ts
export type CreateInternalArtifactObjectInput = InternalArtifactObject;

export interface GetInternalArtifactObjectByRefInput {
  ref: string;
  include_deleted?: boolean;
}

export interface TombstoneInternalArtifactObjectInput {
  ref: string;
  deleted_at: string;
}
```

Add methods to `DeliveryRepository`:

```ts
createOrReplayInternalArtifactObject(input: CreateInternalArtifactObjectInput): Promise<InternalArtifactObject>;
getInternalArtifactObjectByRef(input: GetInternalArtifactObjectByRefInput): Promise<InternalArtifactObject | undefined>;
getInternalArtifactObjectById(id: string): Promise<InternalArtifactObject | undefined>;
tombstoneInternalArtifactObject(input: TombstoneInternalArtifactObjectInput): Promise<InternalArtifactObject>;
```

- [ ] **Step 8: Implement in-memory repository**

Use a `Map<string, InternalArtifactObject>` plus helper indexes by `ref` and owner idempotency. Enforce:

- replay succeeds only if full request/digest/ref/metadata fields match;
- same ref with different idempotency key throws `internal_artifact_ref_conflict`;
- same owner idempotency with different request throws `internal_artifact_idempotency_drift`;
- tombstoned rows are not returned unless `include_deleted: true`.

- [ ] **Step 9: Implement drizzle repository**

Add conversion helpers near existing DB record helpers:

```ts
const internalArtifactObjectFromDbRecord = (row: InternalArtifactObjectDbRecord): InternalArtifactObject => ({
  ...row,
  size_bytes: row.size_bytes.toString(),
  ...(row.deleted_at === undefined ? {} : { deleted_at: row.deleted_at }),
});
```

Use advisory locks:

```ts
`internal-artifact-ref:${input.ref}`,
`internal-artifact-owner-idempotency:${input.owner_type}:${input.owner_id}:${input.idempotency_key}`,
```

Use query-first replay logic rather than relying only on unique constraint errors so implementation can return stable DomainError-like messages.

- [ ] **Step 10: Run DB tests**

Run:

```bash
pnpm vitest run tests/db/schema.test.ts tests/db/reset.test.ts tests/db/internal-artifact-repository.test.ts tests/db/codex-runtime-repository.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit DB metadata layer**

```bash
git add packages/db/src/schema/internal-artifact.ts packages/db/src/schema/index.ts packages/db/src/index.ts packages/db/src/reset.ts packages/db/src/schema/codex-runtime.ts packages/db/src/repositories/delivery-repository.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts tests/db/schema.test.ts tests/db/reset.test.ts tests/db/internal-artifact-repository.test.ts tests/db/codex-runtime-repository.test.ts
git commit -m "feat: persist internal artifact metadata"
```

## Task 3: Local Filesystem Internal Artifact Store

**Files:**
- Create: `packages/db/src/internal-artifacts/types.ts`
- Create: `packages/db/src/internal-artifacts/local-internal-artifact-store.ts`
- Modify: `packages/db/src/index.ts`
- Create: `tests/db/local-internal-artifact-store.test.ts`

- [ ] **Step 1: Write failing local store tests**

Create `tests/db/local-internal-artifact-store.test.ts`:

```ts
import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { codexCanonicalDigest } from '@forgeloop/domain';
import { InMemoryDeliveryRepository, LocalInternalArtifactStore } from '../../packages/db/src/index';

const roots: string[] = [];
const makeRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), 'forgeloop-internal-artifacts-'));
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('LocalInternalArtifactStore', () => {
  it('writes bytes under content-addressed storage and replays idempotently', async () => {
    const repository = new InMemoryDeliveryRepository();
    const store = new LocalInternalArtifactStore({ root: await makeRoot(), repository, requestId: () => 'request-1' });
    const bytes = Buffer.from('{"ok":true}');
    const digest = codexCanonicalDigest(JSON.parse(bytes.toString('utf8')));

    const object = await store.putObject({
      artifact_id: 'artifact-1',
      kind: 'codex_runtime_job_artifact',
      owner_type: 'codex_runtime_job',
      owner_id: 'runtime-job-1',
      visibility: 'internal',
      content_type: 'application/json',
      declared_size_bytes: String(bytes.byteLength),
      declared_artifact_digest: digest,
      idempotency_key: 'idem-1',
      metadata_json: {},
      created_by_actor_type: 'codex_worker',
      created_by_actor_id: 'worker-1',
      now: '2026-05-30T00:00:00.000Z',
      max_size_bytes: 1024,
      bytes,
    });

    const replay = await store.putObject({
      artifact_id: object.artifact_id,
      kind: object.kind,
      owner_type: object.owner_type,
      owner_id: object.owner_id,
      visibility: object.visibility,
      content_type: object.content_type,
      declared_size_bytes: object.size_bytes,
      declared_artifact_digest: object.digest,
      idempotency_key: object.idempotency_key,
      metadata_json: object.metadata_json,
      created_by_actor_type: 'codex_worker',
      created_by_actor_id: 'worker-1',
      now: '2026-05-30T00:00:00.000Z',
      max_size_bytes: 1024,
      bytes,
    });
    expect(replay.ref).toBe(object.ref);
    const read = await store.getObject(object.ref);
    expect(Buffer.from(read.bytes)).toEqual(bytes);
  });

  it('rejects digest mismatch and tombstones reads after delete', async () => {
    const repository = new InMemoryDeliveryRepository();
    const store = new LocalInternalArtifactStore({ root: await makeRoot(), repository, requestId: () => 'request-1' });
    const bytes = Buffer.from('bad');
    await expect(
      store.putObject({
        artifact_id: 'artifact-1',
        kind: 'raw_metadata',
        owner_type: 'system',
        owner_id: 'system',
        visibility: 'internal',
        content_type: 'text/plain',
        declared_size_bytes: String(bytes.byteLength),
        declared_artifact_digest: 'sha256:' + 'a'.repeat(64),
        idempotency_key: 'idem-1',
        metadata_json: {},
        created_by_actor_type: 'system',
        created_by_actor_id: 'system',
        now: '2026-05-30T00:00:00.000Z',
        max_size_bytes: 1024,
        bytes,
      }),
    ).rejects.toThrow('internal_artifact_digest_mismatch');
  });

  it('rejects escaped roots and symlink object paths', async () => {
    const root = await makeRoot();
    const repository = new InMemoryDeliveryRepository();
    const store = new LocalInternalArtifactStore({ root, repository, requestId: () => 'request-1' });
    await symlink('/tmp', join(root, 'objects'));
    await expect(store.statObject('artifact://internal/raw_metadata/system/system/artifact-1')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run local store tests to verify failure**

Run:

```bash
pnpm vitest run tests/db/local-internal-artifact-store.test.ts
```

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Define store types**

Create `packages/db/src/internal-artifacts/types.ts` with:

```ts
import type { InternalArtifactKind, InternalArtifactObject, InternalArtifactOwnerType, InternalArtifactVisibility } from '@forgeloop/domain';

export interface PutInternalArtifactObjectInput {
  artifact_id: string;
  kind: InternalArtifactKind;
  owner_type: InternalArtifactOwnerType;
  owner_id: string;
  visibility: InternalArtifactVisibility;
  content_type: string;
  declared_size_bytes: string;
  declared_artifact_digest: string;
  idempotency_key: string;
  metadata_json: Record<string, unknown>;
  created_by_actor_type: InternalArtifactObject['created_by_actor_type'];
  created_by_actor_id: string;
  now: string;
  max_size_bytes: number;
  bytes: Uint8Array;
}

export interface InternalArtifactObjectRead {
  artifact: InternalArtifactObject;
  bytes: Uint8Array;
}
```

- [ ] **Step 4: Implement local store**

Create `packages/db/src/internal-artifacts/local-internal-artifact-store.ts`:

- resolve root once with `realpath` after `mkdir(root, { recursive: true, mode: 0o700 })`;
- compute `sha256` over uploaded bytes;
- verify declared size and digest;
- write temp file under `{root}/tmp/{request_id}`;
- create object path `{root}/objects/sha256/{first_two_hex}/{full_hex_digest}`;
- use `rename`, but allow replay if the same content-addressed file already exists;
- never follow symlinks; use `lstat` on path components and verify resolved paths stay under root;
- create metadata with `repository.createOrReplayInternalArtifactObject`;
- implement `getObject`, `statObject`, and `deleteObject` by ref.
- keep absolute filesystem paths private to the implementation; `getObject` returns bytes or a stream plus metadata, never an `absolute_path` field.

The canonical ref must be built with `buildInternalArtifactRef`.

- [ ] **Step 5: Export store**

Add exports in `packages/db/src/index.ts`:

```ts
export * from './internal-artifacts/types';
export * from './internal-artifacts/local-internal-artifact-store';
```

- [ ] **Step 6: Run focused store tests**

Run:

```bash
pnpm vitest run tests/db/local-internal-artifact-store.test.ts tests/db/internal-artifact-repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit local store**

```bash
git add packages/db/src/internal-artifacts/types.ts packages/db/src/internal-artifacts/local-internal-artifact-store.ts packages/db/src/index.ts tests/db/local-internal-artifact-store.test.ts
git commit -m "feat: add local internal artifact store"
```

## Task 4: Trusted Internal Artifact API

**Files:**
- Create: `apps/control-plane-api/src/modules/internal-artifacts/internal-artifacts.dto.ts`
- Create: `apps/control-plane-api/src/modules/internal-artifacts/internal-artifacts.service.ts`
- Create: `apps/control-plane-api/src/modules/internal-artifacts/internal-artifacts.controller.ts`
- Create: `apps/control-plane-api/src/modules/internal-artifacts/internal-artifacts.module.ts`
- Modify: `apps/control-plane-api/src/app.module.ts`
- Modify: `apps/control-plane-api/src/modules/core/control-plane-tokens.ts`
- Modify: `apps/control-plane-api/src/modules/core/control-plane-core.module.ts`
- Create: `tests/api/internal-artifacts-api.test.ts`

- [ ] **Step 1: Write failing API tests**

Create `tests/api/internal-artifacts-api.test.ts` using the existing `AppModule` and trusted actor signing helpers from `tests/api/codex-runtime-control-plane.test.ts`:

```ts
it('uploads, stats, downloads, and deletes internal artifacts without leaking storage keys', async () => {
  const bytes = Buffer.from('hello internal artifact');
  const digest = rawSha256(bytes);
  const metadata = {
    schema_version: 'internal_artifact_upload.v1',
    owner_type: 'system',
    owner_id: 'system',
    kind: 'raw_metadata',
    visibility: 'internal',
    content_type: 'text/plain',
    declared_size_bytes: String(bytes.byteLength),
    declared_artifact_digest: digest,
    idempotency_key: 'artifact-upload-1',
    metadata_json: { schema_version: 'test.v1' },
  };

  const upload = await signedRequest(app)
    .post('/internal/artifacts:upload')
    .set('content-type', 'application/octet-stream')
    .set('x-forgeloop-artifact-metadata', Buffer.from(JSON.stringify(metadata)).toString('base64url'))
    .send(bytes)
    .expect(201);

  expect(upload.body.artifact).toMatchObject({
    ref: expect.stringMatching(/^artifact:\/\/internal\/raw_metadata\/system\/system\//),
    size_bytes: String(bytes.byteLength),
    digest,
  });
  expect(JSON.stringify(upload.body)).not.toContain('storage_key');

  const refBase64 = Buffer.from(upload.body.artifact.ref, 'utf8').toString('base64url');
  await signedRequest(app)
    .head(`/internal/artifacts?ref_base64url=${encodeURIComponent(refBase64)}`)
    .expect(200)
    .expect('x-forgeloop-artifact-digest', digest)
    .expect('x-forgeloop-artifact-size-bytes', String(bytes.byteLength));

  await signedRequest(app)
    .get(`/internal/artifacts?ref_base64url=${encodeURIComponent(refBase64)}`)
    .expect(200)
    .expect('x-forgeloop-artifact-ref', upload.body.artifact.ref)
    .expect(bytes.toString('utf8'));

  await signedRequest(app)
    .delete('/internal/artifacts')
    .send({
      schema_version: 'internal_artifact_ref_request.v1',
      ref_base64url: refBase64,
      requester_type: 'admin',
      requester_id: 'automation-daemon',
    })
    .expect(200);

  await signedRequest(app).get(`/internal/artifacts?ref_base64url=${encodeURIComponent(refBase64)}`).expect(404);
});
```

Add tests that unauthenticated calls fail and that `DELETE /internal/artifacts?ref_base64url=...` without JSON body fails.

- [ ] **Step 2: Run API tests to verify failure**

Run:

```bash
FORGELOOP_ARTIFACT_STORE_ROOT="$(mktemp -d)" pnpm vitest run tests/api/internal-artifacts-api.test.ts
```

Expected: FAIL because module/routes do not exist.

- [ ] **Step 3: Implement DTO schemas**

In `internal-artifacts.dto.ts`, define:

- `uploadInternalArtifactMetadataSchema`;
- `internalArtifactRefRequestSchema`;
- helpers that project `InternalArtifactObject` to response DTO without `storage_key`;
- query/header parser for `GET`/`HEAD`.

- [ ] **Step 4: Implement service and module**

`InternalArtifactsService` constructs or receives `LocalInternalArtifactStore`.

Provider rule:

- use `FORGELOOP_ARTIFACT_STORE_ROOT` when set;
- in tests, allow temp root override through env;
- fail fast with a clear error if no root is configured for non-memory runtime mode.

- [ ] **Step 5: Implement controller**

Use:

- `@Post('/internal/artifacts:upload')` with `TrustedAutomationActorGuard`;
- `@Get('/internal/artifacts')`;
- `@Head('/internal/artifacts')`;
- `@Delete('/internal/artifacts')`.

For octet-stream upload, read `request.rawBody` and base64url JSON metadata header. If multipart support is implemented in this task, use `FileInterceptor('file')` and `metadata` JSON part. The tests must cover at least octet-stream because worker uploads will use it.

- [ ] **Step 6: Run focused API tests**

Run:

```bash
FORGELOOP_ARTIFACT_STORE_ROOT="$(mktemp -d)" pnpm vitest run tests/api/internal-artifacts-api.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit trusted API**

```bash
git add apps/control-plane-api/src/modules/internal-artifacts apps/control-plane-api/src/app.module.ts apps/control-plane-api/src/modules/core/control-plane-tokens.ts apps/control-plane-api/src/modules/core/control-plane-core.module.ts tests/api/internal-artifacts-api.test.ts
git commit -m "feat: expose trusted internal artifact API"
```

## Task 5: Runtime Job Artifact Intake Uses Store Bytes

**Files:**
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.module.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `tests/api/codex-runtime-control-plane.test.ts`
- Modify: `tests/db/codex-runtime-repository.test.ts`

- [ ] **Step 1: Write failing runtime upload tests**

In `tests/api/codex-runtime-control-plane.test.ts`, replace the current JSON-only artifact upload expectation with an octet-stream upload:

```ts
const payload = Buffer.from(JSON.stringify({ schema_version: 'test_payload.v1', value: 'ok' }));
const digest = rawSha256(payload);
const metadata = {
  schema_version: 'codex_runtime_job_artifact_upload.v2',
  worker_session_token: clientSuppliedWorkerSessionToken,
  nonce: 'artifact-nonce-1',
  nonce_timestamp: later,
  body_digest: codexCanonicalDigest({
    artifact_idempotency_key: 'artifact-key-1',
    kind: 'generated_payload',
    name: 'payload.json',
    content_type: 'application/json',
    digest,
    size_bytes: String(payload.byteLength),
    metadata_json: { schema_version: 'generated_payload_metadata.v1' },
  }),
  artifact_idempotency_key: 'artifact-key-1',
  kind: 'generated_payload',
  name: 'payload.json',
  content_type: 'application/json',
  digest,
  size_bytes: String(payload.byteLength),
  metadata_json: { schema_version: 'generated_payload_metadata.v1' },
};

const upload = await request(app.getHttpServer())
  .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/artifacts`)
  .set('content-type', 'application/octet-stream')
  .set('x-forgeloop-runtime-artifact-metadata', Buffer.from(JSON.stringify(metadata)).toString('base64url'))
  .send(payload)
  .expect(201);

expect(upload.body.artifact.internal_ref).toMatch(
  /^artifact:\/\/internal\/codex_runtime_job_artifact\/codex_runtime_job\/runtime-job-1\//,
);
expect(JSON.stringify(upload.body)).not.toContain('storage_key');
```

Add a negative test:

```ts
await workerPost(app, `/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/artifacts`, {
  artifact_idempotency_key: 'metadata-only',
  kind: 'generated_payload',
  name: 'payload.json',
  content_type: 'application/json',
  digest,
  size_bytes: String(payload.byteLength),
  metadata_json: { generated_payload: { unsafe: 'legacy canonical path' } },
}).expect(400);
```

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
FORGELOOP_ARTIFACT_STORE_ROOT="$(mktemp -d)" pnpm vitest run tests/api/codex-runtime-control-plane.test.ts -t "artifact"
```

Expected: FAIL because the route still accepts JSON body and emits old-prefix refs.

- [ ] **Step 3: Update runtime artifact DTO**

In `codex-runtime.dto.ts`, keep non-artifact worker schemas unchanged. Replace `createCodexRuntimeJobArtifactSchema` with metadata v2:

```ts
export const createCodexRuntimeJobArtifactUploadMetadataSchema = workerSessionRequestSchema.extend({
  schema_version: z.literal('codex_runtime_job_artifact_upload.v2'),
  artifact_idempotency_key: z.string().min(1),
  kind: z.string().min(1),
  name: z.string().min(1),
  content_type: z.string().min(1),
  digest: sha256DigestSchema,
  size_bytes: z.string().regex(/^\d+$/),
  metadata_json: z.record(z.string(), z.unknown()).default({}),
}).strict();
```

- [ ] **Step 4: Update controller byte extraction**

In `codex-runtime.controller.ts`, change `createRuntimeJobArtifact` to accept raw octet-stream metadata header and bytes:

```ts
@Post('/internal/codex-workers/:workerId/runtime-jobs/:jobId/artifacts')
createRuntimeJobArtifact(
  @Param('workerId') workerId: string,
  @Param('jobId') jobId: string,
  @Req() request: { rawBody?: Buffer; headers: Record<string, string | string[] | undefined> },
) {
  const parsed = parseRuntimeArtifactUploadRequest(request);
  return this.service.createRuntimeJobArtifact(workerId, jobId, parsed);
}
```

Implement `parseRuntimeArtifactUploadRequest` in the controller or DTO file. It must reject missing bytes and reject JSON-only metadata uploads.

- [ ] **Step 5: Update service store write**

In `codex-runtime.service.ts`, inject `InternalArtifactsService` or `LocalInternalArtifactStore`. Replace old internal ref creation:

```ts
const artifactId = deterministicRuntimeArtifactId(jobId, input.artifact_idempotency_key);
const stored = await this.internalArtifacts.putObject({
  artifact_id: artifactId,
  kind: 'codex_runtime_job_artifact',
  owner_type: 'codex_runtime_job',
  owner_id: jobId,
  visibility: 'internal',
  content_type: input.content_type,
  declared_size_bytes: input.size_bytes,
  declared_artifact_digest: input.digest,
  idempotency_key: input.artifact_idempotency_key,
  metadata_json: input.metadata_json,
  created_by_actor_type: 'codex_worker',
  created_by_actor_id: workerId,
  now,
  max_size_bytes: codexRuntimeJobArtifactMaxSizeBytes,
  bytes: input.bytes,
});
```

Then call repository:

```ts
await this.repository.createCodexRuntimeJobArtifact({
  ...existingWorkerFields,
  artifact_id: artifactId,
  internal_artifact_object_id: stored.id,
  internal_ref: stored.ref,
  size_bytes: Number(stored.size_bytes),
});
```

- [ ] **Step 6: Update repository binding contract**

Repository runtime artifact create must:

- verify `internal_artifact_object_id` exists;
- verify object `ref`, owner, digest, content type, and size match binding input;
- allow legacy old-prefix refs only when explicitly marked as pre-Wave-1 migration records in tests, not for new create path;
- return `CodexRuntimeJobArtifact.internal_ref` as the canonical internal ref.

- [ ] **Step 7: Run runtime and DB focused tests**

Run:

```bash
FORGELOOP_ARTIFACT_STORE_ROOT="$(mktemp -d)" pnpm vitest run tests/api/codex-runtime-control-plane.test.ts tests/db/codex-runtime-repository.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit runtime store intake**

```bash
git add apps/control-plane-api/src/modules/codex-runtime packages/db/src/repositories tests/api/codex-runtime-control-plane.test.ts tests/db/codex-runtime-repository.test.ts
git commit -m "feat: store runtime job artifacts as internal bytes"
```

## Task 6: Worker Clients Upload Artifact Bytes

**Files:**
- Modify: `packages/codex-worker-runtime/src/runtime-job-artifacts.ts`
- Modify: `packages/codex-worker-runtime/src/control-plane-client.ts`
- Modify: `packages/codex-worker-runtime/src/remote-worker-client.ts`
- Modify: `packages/codex-worker-runtime/src/workspace-bundle.ts`
- Modify: `tests/codex-worker-runtime/control-plane-client.test.ts`
- Modify: `tests/codex-worker-runtime/remote-worker-client.test.ts`
- Modify: `tests/codex-worker-runtime/workspace-bundle.test.ts`

- [ ] **Step 1: Write failing worker client tests**

In `tests/codex-worker-runtime/control-plane-client.test.ts`, update artifact upload assertions:

```ts
await client.uploadRuntimeJobArtifact('worker-1', 'runtime-job-1', {
  workerSessionToken: 'session-1',
  artifact_idempotency_key: 'artifact-1',
  kind: 'generated_payload',
  name: 'payload.json',
  content_type: 'application/json',
  digest: 'sha256:' + 'd'.repeat(64),
  size_bytes: '12',
  metadata_json: { schema: 'test' },
  bytes: Buffer.from('hello world!'),
});

const artifactRequest = requests.find((request) => new URL(request.url).pathname.endsWith('/artifacts'))!;
expect(artifactRequest.init.method).toBe('POST');
expect(artifactRequest.init.headers).toMatchObject({
  'content-type': 'application/octet-stream',
});
expect(artifactRequest.init.body).toEqual(Buffer.from('hello world!'));
expect(String((artifactRequest.init.headers as Record<string, string>)['x-forgeloop-runtime-artifact-metadata'])).toMatch(/^[A-Za-z0-9_-]+$/);
```

In `tests/codex-worker-runtime/workspace-bundle.test.ts`, assert `createWorkspaceBundlePatchArtifact` no longer returns an old-prefix `internal_ref`.

- [ ] **Step 2: Run worker tests to verify failure**

Run:

```bash
pnpm vitest run tests/codex-worker-runtime/control-plane-client.test.ts tests/codex-worker-runtime/workspace-bundle.test.ts
```

Expected: FAIL because worker uploads are JSON-only and patch helper emits old refs.

- [ ] **Step 3: Update runtime artifact helper**

In `runtime-job-artifacts.ts`, change input to:

```ts
export interface RuntimeJobArtifactUploadInput {
  artifact_idempotency_key: string;
  kind: string;
  name: string;
  content_type: string;
  digest: string;
  size_bytes: string;
  metadata_json?: Record<string, unknown>;
  bytes: Uint8Array;
}
```

Make `jsonRuntimeJobArtifactUpload` encode bytes first:

```ts
const bytes = Buffer.from(JSON.stringify(input.payload), 'utf8');
const digest = codexCanonicalDigest(input.payload);
return {
  artifact_idempotency_key: codexCanonicalDigest({ kind: input.kind, name: input.name, digest }),
  kind: input.kind,
  name: input.name,
  content_type: 'application/json',
  digest,
  size_bytes: String(bytes.byteLength),
  bytes,
  ...(input.metadata === undefined ? {} : { metadata_json: input.metadata }),
};
```

- [ ] **Step 4: Update control-plane client**

In `control-plane-client.ts`, special-case `uploadRuntimeJobArtifact`:

- build worker metadata object with nonce, nonce timestamp, worker session token, and body digest;
- put metadata in `x-forgeloop-runtime-artifact-metadata` base64url JSON header;
- send bytes as request body with `content-type: application/octet-stream`;
- do not include JSON request body for artifact uploads.

- [ ] **Step 5: Update remote worker client artifacts**

Update every `uploadRuntimeJobArtifact` call so it includes `bytes`. Generated payloads, validation reports, failure evidence, and run-execution patches must use the same bytes used for digest and size.

For run execution patch:

```ts
const localPatch = createWorkspaceBundlePatchArtifact(...);
const upload = {
  artifact_idempotency_key: codexCanonicalDigest({
    runtime_job_id: job.id,
    kind: 'run_execution_patch',
    digest: localPatch.digest,
  }),
  kind: 'run_execution_patch',
  name: 'run-execution.patch',
  content_type: localPatch.content_type,
  digest: localPatch.digest,
  size_bytes: String(localPatch.bytes.byteLength),
  bytes: localPatch.bytes,
  metadata_json: { changed_files: localPatch.changed_files },
};
```

- [ ] **Step 6: Remove old-prefix patch helper output**

In `workspace-bundle.ts`, make `createWorkspaceBundlePatchArtifact` return only:

```ts
{
  content_type: 'text/x-diff',
  digest,
  size_bytes,
  bytes,
  changed_files,
}
```

The control plane returned artifact is the only source of canonical `internal_ref`.

- [ ] **Step 7: Run focused worker tests**

Run:

```bash
pnpm vitest run tests/codex-worker-runtime/control-plane-client.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts tests/codex-worker-runtime/workspace-bundle.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit worker byte uploads**

```bash
git add packages/codex-worker-runtime/src/runtime-job-artifacts.ts packages/codex-worker-runtime/src/control-plane-client.ts packages/codex-worker-runtime/src/remote-worker-client.ts packages/codex-worker-runtime/src/workspace-bundle.ts tests/codex-worker-runtime/control-plane-client.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts tests/codex-worker-runtime/workspace-bundle.test.ts
git commit -m "feat: upload codex runtime artifacts with bytes"
```

## Task 7: Pending Workspace Bundles Use Internal Store

**Files:**
- Modify: `packages/run-worker/src/run-worker.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts`
- Modify: `tests/run-worker/run-worker.test.ts`
- Modify: `tests/db/codex-runtime-repository.test.ts`
- Modify: `tests/api/codex-runtime-control-plane.test.ts`

- [ ] **Step 1: Write failing pending bundle tests**

In `tests/run-worker/run-worker.test.ts`, update pending workspace bundle assertions:

```ts
expect(repository.pendingWorkspaceBundleInputs[0]).toMatchObject({
  archive_bytes_base64: undefined,
  pending_artifact_ref: expect.stringMatching(/^artifact:\/\/internal\/workspace_bundle\/run_session\/run-session-/),
  internal_artifact_object_id: expect.any(String),
});
expect(repository.internalArtifactObjects).toHaveLength(1);
expect(repository.internalArtifactObjects[0]).toMatchObject({
  kind: 'workspace_bundle',
  owner_type: 'run_session',
});
```

In `tests/api/codex-runtime-control-plane.test.ts`, update workspace bundle download to assert bytes are returned from the store and that a legacy DB-byte row still works only through the trusted runtime path.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
FORGELOOP_ARTIFACT_STORE_ROOT="$(mktemp -d)" pnpm vitest run tests/run-worker/run-worker.test.ts tests/api/codex-runtime-control-plane.test.ts -t "workspace bundle"
```

Expected: FAIL because pending bundle bytes are still stored in DB.

- [ ] **Step 3: Update run-worker bundle creation**

In `packages/run-worker/src/run-worker.ts`:

- create or receive a `LocalInternalArtifactStore`;
- write archive bytes before calling `createPendingWorkspaceBundleArtifact`;
- use canonical ref `artifact://internal/workspace_bundle/run_session/{run_session_id}/{bundle_id}`;
- set `workspace_acquisition_json.archive_ref` to that ref;
- pass `internal_artifact_object_id` or `internal_artifact_ref` to repository;
- pass `archive_bytes_base64: undefined` for new rows.

- [ ] **Step 4: Update repository pending bundle contract**

Allow `archive_bytes_base64?: string` only for legacy rows. For new rows:

- require `internal_artifact_object_id`;
- verify object kind `workspace_bundle`;
- verify owner type `run_session`;
- verify digest, size, manifest digest metadata, run session id, execution package id, and lease id;
- reject replay drift as `workspace_bundle_idempotency_drift`.

- [ ] **Step 5: Update runtime-job bundle binding**

When binding a pending bundle to a runtime job:

- create runtime-job artifact row pointing at the same `internalArtifactObjectId`;
- keep binding row kind `workspace_bundle`;
- keep backing object kind `workspace_bundle`;
- ensure replay succeeds only when existing binding points at the same internal ref/digest/manifest.

- [ ] **Step 6: Update workspace bundle download**

`getWorkspaceBundleDownloadForRuntimeJob` must:

- verify worker/session/job/lease/pending/binding fences as today;
- if `internal_artifact_object_id` exists, read bytes from InternalArtifactStore and verify digest before returning;
- if only legacy `archive_bytes_base64` exists, read through the explicit trusted migration path and recompute digest/manifest before returning;
- never expose legacy DB bytes through browser/product APIs.

- [ ] **Step 7: Run focused tests**

Run:

```bash
FORGELOOP_ARTIFACT_STORE_ROOT="$(mktemp -d)" pnpm vitest run tests/run-worker/run-worker.test.ts tests/db/codex-runtime-repository.test.ts tests/api/codex-runtime-control-plane.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit pending bundle migration**

```bash
git add packages/run-worker/src/run-worker.ts packages/db/src/repositories apps/control-plane-api/src/modules/codex-runtime tests/run-worker/run-worker.test.ts tests/db/codex-runtime-repository.test.ts tests/api/codex-runtime-control-plane.test.ts
git commit -m "feat: store pending workspace bundles internally"
```

## Task 8: Generated Payload Resolution And Runtime Consumer Migration

**Files:**
- Modify: `apps/control-plane-api/src/modules/automation/product-generation-result.service.ts`
- Modify: `apps/automation-daemon/src/generation-runtime.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `tests/api/automation-daemon.integration.test.ts`
- Modify: `tests/api/codex-runtime-control-plane.test.ts`
- Modify: `tests/domain/codex-runtime.test.ts`

- [ ] **Step 1: Write failing generated payload resolution test**

In `tests/api/codex-runtime-control-plane.test.ts` or `tests/api/automation-daemon.integration.test.ts`, create a generated payload artifact where:

- stored bytes contain the generated payload JSON;
- `metadata_json` intentionally does not contain `generated_payload`;
- terminal result uses `generated_payload_ref.v1`;
- product-generation application succeeds.

Assertion:

```ts
expect(applied.generated_payload).toEqual(expectedGeneratedPayload);
expect(JSON.stringify(runtimeArtifact.metadata_json)).not.toContain('generated_payload');
```

- [ ] **Step 2: Write failing daemon validation test**

In `tests/api/automation-daemon.integration.test.ts`, assert a generation artifact with:

```ts
internal_ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/artifact-1'
```

is accepted, while:

```ts
internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/artifact-1'
```

is rejected in new generation results.

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
FORGELOOP_ARTIFACT_STORE_ROOT="$(mktemp -d)" pnpm vitest run tests/api/codex-runtime-control-plane.test.ts tests/api/automation-daemon.integration.test.ts
```

Expected: FAIL because generated payload resolution still reads metadata and daemon still checks old prefix.

- [ ] **Step 4: Add repository lookup helper for runtime artifact refs**

Add repository method:

```ts
getCodexRuntimeJobArtifactByInternalRef(input: {
  runtime_job_id: string;
  internal_ref: string;
}): Promise<CodexRuntimeJobArtifact | undefined>;
```

It must verify binding row belongs to the runtime job and, for new refs, backing object exists and matches digest/content type/kind.

- [ ] **Step 5: Resolve generated payload bytes**

In `ProductGenerationResultService.resolveGeneratedPayload`:

- find runtime binding by `runtime_job_id` and `internal_ref`;
- verify binding kind is `generated_payload`;
- verify content type is `application/json`;
- verify digest equals `generated_payload_digest`;
- load bytes from InternalArtifactStore by canonical ref;
- parse JSON from bytes;
- verify `codexCanonicalDigest(parsed) === generated_payload_digest`;
- ignore `metadata_json.generated_payload`.

- [ ] **Step 6: Update automation daemon validation**

In `apps/automation-daemon/src/generation-runtime.ts`, replace old-prefix check with internal runtime artifact validation:

```ts
if (!isInternalArtifactRefString(artifact.internal_ref)) {
  throw new CodexGenerationError('generated_output_schema_invalid', { retryable: false });
}
```

If the daemon must also verify runtime job ownership, use a helper that parses the ref and checks `owner_type === 'codex_runtime_job' && owner_id === runtimeJobId`.

- [ ] **Step 7: Run focused consumer tests**

Run:

```bash
FORGELOOP_ARTIFACT_STORE_ROOT="$(mktemp -d)" pnpm vitest run tests/api/codex-runtime-control-plane.test.ts tests/api/automation-daemon.integration.test.ts tests/domain/codex-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit consumer migration**

```bash
git add apps/control-plane-api/src/modules/automation/product-generation-result.service.ts apps/automation-daemon/src/generation-runtime.ts packages/db/src/repositories tests/api/automation-daemon.integration.test.ts tests/api/codex-runtime-control-plane.test.ts tests/domain/codex-runtime.test.ts
git commit -m "feat: resolve generated payload artifacts from store bytes"
```

## Task 9: No-Baggage Guards And Final Verification

**Files:**
- Modify: `tests/smoke/codex-runtime-no-baggage-gate.test.ts`
- Modify: `docs/runbooks/codex-remote-worker-runtime.md`

- [ ] **Step 1: Add no-baggage smoke assertions**

In `tests/smoke/codex-runtime-no-baggage-gate.test.ts`, add scans that fail if new-write code still emits old prefixes:

```ts
const forbiddenNewWritePatterns = [
  'artifact://codex-runtime-jobs/',
  'artifact:codex-pending-bundles:',
  'metadata_json.generated_payload',
  'archive_bytes_base64: input.archive_bytes_base64',
];

for (const pattern of forbiddenNewWritePatterns) {
  expect(newWriteSource).not.toContain(pattern);
}
```

Keep migration tests allowlisted by path/name. The test should allow old-prefix strings only in:

- explicit migration adapter tests;
- spec/plan docs;
- legacy fixture names proving rejection.

- [ ] **Step 2: Add product exposure assertions**

Add smoke checks that product-facing DTO/query files do not contain `storage_key`, `internal_artifact_objects.storageKey`, or direct internal artifact download URLs.

- [ ] **Step 3: Run smoke no-baggage test**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-no-baggage-gate.test.ts
```

Expected: PASS.

- [ ] **Step 4: Update runbook with the artifact store root**

In `docs/runbooks/codex-remote-worker-runtime.md`, add a short operator note:

```md
Set `FORGELOOP_ARTIFACT_STORE_ROOT` to a private local directory owned by the control-plane process. Runtime job artifacts and pending workspace bundles are stored as `artifact://internal/...` refs; product Attachments are not used for these internal bytes.
```

- [ ] **Step 5: Run targeted package tests**

Run:

```bash
FORGELOOP_ARTIFACT_STORE_ROOT="$(mktemp -d)" pnpm vitest run \
  tests/domain/internal-artifacts.test.ts \
  tests/domain/codex-runtime.test.ts \
  tests/db/internal-artifact-repository.test.ts \
  tests/db/local-internal-artifact-store.test.ts \
  tests/db/codex-runtime-repository.test.ts \
  tests/api/internal-artifacts-api.test.ts \
  tests/api/codex-runtime-control-plane.test.ts \
  tests/api/automation-daemon.integration.test.ts \
  tests/codex-worker-runtime/control-plane-client.test.ts \
  tests/codex-worker-runtime/remote-worker-client.test.ts \
  tests/codex-worker-runtime/workspace-bundle.test.ts \
  tests/run-worker/run-worker.test.ts \
  tests/smoke/codex-runtime-no-baggage-gate.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full verification**

Run:

```bash
FORGELOOP_ARTIFACT_STORE_ROOT="$(mktemp -d)" pnpm test
pnpm build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 7: Run final stale scan**

Run:

```bash
rg -n 'artifact://codex-runtime-jobs/|artifact:codex-pending-bundles:|metadata_json\.generated_payload|storage_key|archive_bytes_base64' \
  apps packages tests scripts \
  -g '!docs/**'
```

Expected:

- old runtime prefix appears only in explicit legacy migration/rejection tests or adapter helpers;
- `artifact:codex-pending-bundles:` appears only in legacy migration/rejection tests;
- `metadata_json.generated_payload` does not appear in canonical generated-payload resolution;
- `storage_key` appears only in internal artifact store/repository internals, never product DTO/query files;
- `archive_bytes_base64` appears only for nullable legacy migration support and tests.

- [ ] **Step 8: Commit final guards**

```bash
git add tests/smoke/codex-runtime-no-baggage-gate.test.ts docs/runbooks/codex-remote-worker-runtime.md
git commit -m "test: guard internal artifact store no-baggage paths"
```

## Final Review And Handoff

- [ ] **Step 1: Request code review**

Use `superpowers:requesting-code-review` with:

- implemented scope: Wave 1 Internal Artifact Store Foundation;
- spec: `docs/superpowers/specs/2026-05-30-internal-artifact-store-foundation-design.md`;
- plan: `docs/superpowers/plans/2026-05-30-internal-artifact-store-foundation.md`;
- base SHA before Task 1;
- head SHA after Task 9.

- [ ] **Step 2: Fix Critical/Important review findings**

If review reports blockers, fix them and rerun affected targeted tests plus `pnpm test`, `pnpm build`, and `git diff --check`.

- [ ] **Step 3: Final status**

Before claiming completion, report:

- final commit hash range;
- all verification commands and results;
- any intentionally retained legacy adapter paths and their removal gate before Wave 4;
- confirmation that root worktree `/Users/viv/projs/forgeloop` stayed on `main`.
