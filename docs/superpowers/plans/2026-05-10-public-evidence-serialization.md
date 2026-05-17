> Superseded historical migration note: this document mentions the old subsystem name for audit history only. Current commands, routes, files, and product docs use delivery terminology.

# Public Evidence Serialization Implementation Plan

## Status

Completed and merged to `main` on 2026-05-11.

- Merge head: `1b56977` (`merge: public evidence serialization`)
- Verified after merge: `pnpm build`
- Verified after merge: `pnpm test`
- Verified after merge: `git diff --check`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one strict public evidence/replay serialization boundary so public query, Evidence Chain, replay, and future Release views cannot leak raw/local/sensitive evidence.

**Architecture:** Contracts own strict public DTO schemas and safety predicates. The db query package owns the single shared serializer implementation and exports it through `@forgeloop/db`. API code reuses that serializer instead of keeping local artifact redaction rules.

**Tech Stack:** TypeScript, Zod v4, Vitest, NestJS test app, `@forgeloop/contracts`, `@forgeloop/domain`, `@forgeloop/db`.

---

## Scope And Guardrails

Implement only the public serialization boundary from [the spec](/Users/viv/projs/forgeloop/docs/superpowers/specs/2026-05-10-public-evidence-serialization-design.md). Do not implement `ReleaseModule`, Release cockpit, Release replay routes, UI work, or raw response compatibility aliases.

Use a dedicated feature worktree before implementation if this plan is executed outside the current docs-only session. Suggested branch/worktree name: `feature/public-evidence-serialization`.

## File Structure

- Create: `packages/contracts/src/public-evidence.ts`
  - Public DTO schemas and types.
  - Shared pure safety helpers used by contract validation and db serializers:
    - `normalizePublicEvidenceKey`
    - `isUnsafePublicEvidenceKey`
    - `isLocalReferenceString`
    - `isPublicArtifactStorageUri`
- Modify: `packages/contracts/src/api.ts`
  - Add `unsafe_storage_uri` to `evidenceChainRedactionReasonSchema`.
- Modify: `packages/contracts/src/index.ts`
  - Export `./public-evidence.js`.
- Modify: `packages/db/package.json`
  - Add `@forgeloop/contracts: "workspace:*"`.
- Modify: `pnpm-lock.yaml`
  - Reflect the new `packages/db` workspace dependency.
- Create: `packages/db/src/queries/public-evidence-serialization.ts`
  - Single implementation of public artifact redaction and typed serializers.
- Modify: `packages/db/src/index.ts`
  - Export `./queries/public-evidence-serialization`.
- Modify: `packages/db/src/queries/replay-queries.ts`
  - Replace local artifact serializer and raw payloads with public serializers.
- Modify: `apps/control-plane-api/src/p0/evidence-chain.ts`
  - Import artifact redaction helpers from `@forgeloop/db`.
  - Keep Evidence Chain item shape unchanged; do not add `details.artifact`.
- Modify: `apps/control-plane-api/src/p0/run-session-serialization.ts`
  - Reuse shared artifact serialization for run-session artifacts and check stdout/stderr.
- Create: `tests/contracts/public-evidence.test.ts`
  - Public DTO schema and safety helper tests.
- Modify: `tests/contracts/evidence-chain.test.ts`
  - Add `unsafe_storage_uri` enum coverage.
- Create: `tests/db/public-evidence-serialization.test.ts`
  - Focused serializer behavior tests.
- Modify: `tests/api/query-module.test.ts`
  - Public replay API leakage tests.
- Modify: `tests/api/evidence-chain.test.ts`
  - Evidence Chain unsafe URI redaction tests.
- Create: `tests/api/run-session-serialization.test.ts`
  - Focused API serializer test proving run-session serialization uses shared public artifact rules.

## Task 1: Add Public Evidence Contracts

**Files:**
- Create: `packages/contracts/src/public-evidence.ts`
- Modify: `packages/contracts/src/api.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `tests/contracts/public-evidence.test.ts`
- Test: `tests/contracts/evidence-chain.test.ts`

- [x] **Step 1: Write failing public DTO contract tests**

Create `tests/contracts/public-evidence.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  isLocalReferenceString,
  isPublicArtifactStorageUri,
  isUnsafePublicEvidenceKey,
  publicArtifactRefSchema,
  publicDecisionSchema,
  publicObjectEventSchema,
  publicReleaseEvidenceSchema,
  publicReplayEntrySchema,
  publicStatusHistorySchema,
} from '@forgeloop/contracts';

const timestamp = '2026-05-10T00:00:00.000Z';

describe('public evidence contracts', () => {
  it('accepts a safe public artifact and rejects raw/local artifact shapes', () => {
    expect(
      publicArtifactRefSchema.parse({
        kind: 'diff',
        name: 'Patch',
        content_type: 'text/x-patch',
        storage_uri: 's3://forgeloop-artifacts/run-1/diff.patch',
        digest: 'sha256:abc',
      }),
    ).toMatchObject({ kind: 'diff' });

    for (const artifact of [
      { kind: 'logs', name: 'Logs', content_type: 'text/plain', storage_uri: 's3://bucket/logs.txt' },
      { kind: 'raw_metadata', name: 'Raw', content_type: 'application/json', storage_uri: 's3://bucket/raw.json' },
      { kind: 'diff', name: 'Local', content_type: 'text/x-patch', local_ref: 'artifacts/run-1/diff.patch' },
      { kind: 'diff', name: 'Raw ref', content_type: 'text/x-patch', storage_uri: 's3://bucket/diff.patch', raw_ref: 'x' },
      { kind: 'diff', name: 'No storage', content_type: 'text/x-patch' },
      { kind: 'diff', name: 'File', content_type: 'text/x-patch', storage_uri: 'file:///Users/viv/out.patch' },
      { kind: 'diff', name: 'Local scheme', content_type: 'text/x-patch', storage_uri: 'local://run/out.patch' },
      { kind: 'diff', name: 'HTTP', content_type: 'text/x-patch', storage_uri: 'http://example.test/out.patch' },
      { kind: 'diff', name: 'Userinfo', content_type: 'text/x-patch', storage_uri: 'https://user:pass@example.test/out.patch' },
      { kind: 'diff', name: 'Query', content_type: 'text/x-patch', storage_uri: 'https://example.test/out.patch?token=secret' },
      { kind: 'diff', name: 'Fragment', content_type: 'text/x-patch', storage_uri: 'https://example.test/out.patch#frag' },
      { kind: 'diff', name: 'S3 query', content_type: 'text/x-patch', storage_uri: 's3://bucket/out.patch?x=y' },
      { kind: 'diff', name: 'GS fragment', content_type: 'text/x-patch', storage_uri: 'gs://bucket/out.patch#frag' },
      { kind: 'diff', name: 'Encoded local', content_type: 'text/x-patch', storage_uri: 'https://example.test/%2FUsers%2Fviv%2Fout.patch' },
    ]) {
      expect(publicArtifactRefSchema.safeParse(artifact).success).toBe(false);
    }
  });

  it('exposes deterministic safety predicates', () => {
    expect(isUnsafePublicEvidenceKey('accessToken')).toBe(true);
    expect(isUnsafePublicEvidenceKey('client_secret')).toBe(true);
    expect(isUnsafePublicEvidenceKey('token_count')).toBe(false);
    expect(isUnsafePublicEvidenceKey('secretary_note')).toBe(false);

    expect(isLocalReferenceString('/Users/viv/projs/forgeloop/out.log')).toBe(true);
    expect(isLocalReferenceString('/private/tmp/out.log')).toBe(true);
    expect(isLocalReferenceString('/var/log/forgeloop.log')).toBe(true);
    expect(isLocalReferenceString('/mnt/work/out.log')).toBe(true);
    expect(isLocalReferenceString('/Volumes/work/out.log')).toBe(true);
    expect(isLocalReferenceString('/workspace/app/out.log')).toBe(true);
    expect(isLocalReferenceString('C:\\Users\\viv\\out.log')).toBe(true);
    expect(isLocalReferenceString('\\\\server\\share\\out.log')).toBe(true);
    expect(isLocalReferenceString('file:///Users/viv/out.log')).toBe(true);
    expect(isLocalReferenceString('local://run/out.log')).toBe(true);
    expect(isLocalReferenceString('artifacts/run/out.log')).toBe(true);
    expect(isLocalReferenceString('./artifacts/run/out.log')).toBe(true);
    expect(isLocalReferenceString('../artifacts/run/out.log')).toBe(true);
    expect(isLocalReferenceString('/query/replay/work_item/1')).toBe(false);

    expect(isPublicArtifactStorageUri('s3://bucket/key')).toBe(true);
    expect(isPublicArtifactStorageUri('gs://bucket/key')).toBe(true);
    expect(isPublicArtifactStorageUri('https://example.test/key')).toBe(true);
    expect(isPublicArtifactStorageUri('s3://')).toBe(false);
    expect(isPublicArtifactStorageUri('https:///key')).toBe(false);
    expect(isPublicArtifactStorageUri('s3://bucket/key?x=y')).toBe(false);
    expect(isPublicArtifactStorageUri('gs://bucket/key#frag')).toBe(false);
  });

  it('rejects unknown nested public payload keys', () => {
    const objectEvent = {
      id: 'event-1',
      object_type: 'work_item',
      object_id: 'work-item-1',
      event_type: 'work_item_changed',
      payload: { work_item_id: 'work-item-1', raw_payload: 'secret' },
      created_at: timestamp,
    };
    expect(publicObjectEventSchema.safeParse(objectEvent).success).toBe(false);

    const statusHistory = {
      id: 'status-1',
      object_type: 'work_item',
      object_id: 'work-item-1',
      to_status: 'ready',
      context: { work_item_id: 'work-item-1', output_path: '/Users/viv/out.log' },
      created_at: timestamp,
    };
    expect(publicStatusHistorySchema.safeParse(statusHistory).success).toBe(false);
  });

  it('rejects unsafe release evidence metrics and unknown extra groups', () => {
    const base = {
      id: 'evidence-1',
      release_id: 'release-1',
      evidence_type: 'observation_note',
      summary: 'Observed',
      extra: {
        observation: {
          source: 'human',
          severity: 'info',
          summary: 'Looks stable',
          observed_at: timestamp,
          metrics: { latency_ms: 10 },
        },
      },
      redacted: false,
      status: 'current',
      created_at: timestamp,
    };

    expect(publicReleaseEvidenceSchema.parse(base)).toMatchObject({ id: 'evidence-1' });
    expect(
      publicReleaseEvidenceSchema.safeParse({
        ...base,
        extra: { observation: { ...base.extra.observation, metrics: { accessToken: 'secret' } } },
      }).success,
    ).toBe(false);
    expect(
      publicReleaseEvidenceSchema.safeParse({
        ...base,
        extra: { observation: { ...base.extra.observation, metrics: { output_path: '/Users/viv/out.log' } } },
      }).success,
    ).toBe(false);
    expect(publicReleaseEvidenceSchema.safeParse({ ...base, extra: { private_payload: {} } }).success).toBe(false);
  });

  it('accepts every public release evidence extra group', () => {
    const base = {
      id: 'evidence-2',
      release_id: 'release-1',
      evidence_type: 'observation_note',
      summary: 'Release evidence',
      redacted: false,
      status: 'current',
      created_at: timestamp,
    };

    expect(
      publicReleaseEvidenceSchema.parse({
        ...base,
        extra: {
          observation: {
            source: 'script',
            severity: 'warning',
            summary: 'Latency increased',
            observed_at: timestamp,
            metrics: { latency_ms: 250 },
          },
          deployment: {
            environment: 'production',
            result: 'succeeded',
            deployment_id: 'deploy-1',
            completed_at: timestamp,
          },
          rollback: {
            result: 'not_required',
            reason: 'No rollback needed',
          },
          build: {
            build_id: 'build-1',
            result: 'succeeded',
            artifact: {
              kind: 'diff',
              name: 'Build patch',
              content_type: 'text/x-patch',
              storage_uri: 's3://bucket/build.patch',
            },
          },
          check_refs: [
            {
              check_id: 'contracts',
              status: 'succeeded',
              artifact: {
                kind: 'check_output',
                name: 'stdout',
                content_type: 'text/plain',
                storage_uri: 'gs://bucket/stdout.txt',
              },
            },
          ],
        },
      }),
    ).toMatchObject({ id: 'evidence-2' });
  });

  it('enforces replay source and payload pairing', () => {
    expect(
      publicReplayEntrySchema.parse({
        id: 'entry-1',
        source: 'decision',
        object_type: 'work_item',
        object_id: 'work-item-1',
        summary: 'Approved',
        created_at: timestamp,
        payload: {
          id: 'decision-1',
          object_type: 'work_item',
          object_id: 'work-item-1',
          actor_id: 'actor-1',
          decision: 'approved',
          summary: 'Approved',
          created_at: timestamp,
        },
      }),
    ).toMatchObject({ source: 'decision' });

    expect(
      publicReplayEntrySchema.parse({
        id: 'entry-release-evidence',
        source: 'release_evidence',
        object_type: 'release',
        object_id: 'release-1',
        summary: 'Release evidence',
        created_at: timestamp,
        payload: {
          id: 'evidence-1',
          release_id: 'release-1',
          evidence_type: 'observation_note',
          summary: 'Observed',
          extra: {},
          redacted: false,
          status: 'current',
          created_at: timestamp,
        },
      }),
    ).toMatchObject({ source: 'release_evidence' });

    expect(
      publicReplayEntrySchema.safeParse({
        id: 'entry-2',
        source: 'decision',
        object_type: 'artifact',
        object_id: 'artifact-1',
        summary: 'Artifact',
        created_at: timestamp,
        payload: {
          kind: 'diff',
          name: 'Patch',
          content_type: 'text/x-patch',
          storage_uri: 's3://bucket/key',
        },
      }).success,
    ).toBe(false);
  });
});
```

In `tests/contracts/evidence-chain.test.ts`, extend the existing redaction-reason test list with `unsafe_storage_uri`.

- [x] **Step 2: Run contract tests to verify failure**

Run:

```bash
pnpm vitest run tests/contracts/public-evidence.test.ts tests/contracts/evidence-chain.test.ts
```

Expected: FAIL because `public-evidence.ts` does not exist and `unsafe_storage_uri` is not in the Evidence Chain enum.

- [x] **Step 3: Implement public contract schemas and helpers**

Create `packages/contracts/src/public-evidence.ts`. Keep the code pure: no db/app imports.

Implementation notes:
- Use explicit `publicArtifactKindSchema = z.enum(['diff', 'changed_files', 'check_output', 'execution_summary', 'self_review', 'review_packet'])`.
- Use `.strict()` on every object schema.
- Use `.superRefine()` for `PublicMetrics` and `PublicArtifactRef`.
- Match the spec's unsafe-key rules exactly: `token` and keys ending in `_token` are unsafe, but `token_count` is a safe near-miss and must not be caught by a `token_` prefix rule.
- `isLocalReferenceString()` should percent-decode before checks and should detect POSIX, Windows, UNC, `file://`, `local://`, and artifact-relative paths.
- `isPublicArtifactStorageUri()` should reject userinfo/query/fragment and require non-empty host/bucket.

Add the `unsafe_storage_uri` literal to `evidenceChainRedactionReasonSchema` in `packages/contracts/src/api.ts`.

Export from `packages/contracts/src/index.ts`:

```ts
export * from './public-evidence.js';
```

- [x] **Step 4: Run contract tests to verify pass**

Run:

```bash
pnpm vitest run tests/contracts/public-evidence.test.ts tests/contracts/evidence-chain.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit contracts**

```bash
git add packages/contracts/src tests/contracts
git commit -m "feat: add public evidence contracts"
```

## Task 2: Add Shared Public Evidence Serializer

**Files:**
- Modify: `packages/db/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/db/src/queries/public-evidence-serialization.ts`
- Modify: `packages/db/src/index.ts`
- Test: `tests/db/public-evidence-serialization.test.ts`

- [x] **Step 1: Write failing serializer tests**

Create `tests/db/public-evidence-serialization.test.ts`.

Include tests for:
- `artifactRedactionReason()` returns:
  - `logs_artifact`
  - `raw_metadata_artifact`
  - `raw_ref`
  - `local_ref_only`
  - `unsafe_storage_uri`
- `serializePublicArtifactRef()` returns a strict public artifact and removes `local_ref`.
- `serializePublicDecision()` omits `evidence_refs`.
- `serializePublicObjectEvent()` drops unknown/sensitive payload keys and filters invalid arrays.
- `serializePublicStatusHistory()` drops unknown/sensitive context keys and filters invalid arrays.
- `serializePublicReleaseEvidence()` sanitizes `extra` groups, validates dynamic `metrics`, omits invalid groups, and preserves `artifact_id` even when `artifact` is unsafe.
- `serializePublicReplayEntry()` enforces source/payload pairing.

Use this hostile matrix in the test:

```ts
const hostileStrings = [
  '/Users/viv/projs/forgeloop/out.log',
  '/home/runner/out.log',
  '/workspace/app/out.log',
  '/opt/build/out.log',
  '/tmp/out.log',
  '/private/tmp/out.log',
  '/var/log/forgeloop.log',
  '/mnt/work/out.log',
  '/Volumes/work/out.log',
  'C:\\Users\\viv\\out.log',
  '\\\\server\\share\\out.log',
  'file:///Users/viv/out.log',
  'local://run/out.log',
  'artifacts/run/out.log',
  './artifacts/run/out.log',
  '../artifacts/run/out.log',
  'https://example.test/artifact?token=secret',
  'https://user:pass@example.test/object',
  'https://example.test/object#frag',
  's3://bucket/key?x=y',
  'gs://bucket/key#frag',
  'https://example.test/%2FUsers%2Fviv%2Fout.log',
];

const unsafeKeys = [
  'token',
  'accessToken',
  'access_token',
  'clientSecret',
  'client_secret',
  'authorization',
  'auth_header',
  'api_key',
  'password',
  'private_key',
];
```

Example assertion:

```ts
it('sanitizes object event payloads without throwing on bad stored values', () => {
  const event = serializePublicObjectEvent({
    id: 'event-1',
    object_type: 'work_item',
    object_id: 'work-item-1',
    event_type: 'work_item_changed',
    actor_type: 'system',
    actor_id: 'actor-1',
    reason: 'transitioned',
    metadata: { internal_payload: 'do not expose' },
    payload: {
      work_item_id: 'work-item-1',
      required_check_ids: ['contracts', 123, 'api'],
      token_count: 2,
      secret: 'drop',
      output_path: '/Users/viv/out.log',
      unknown: 'drop',
    },
    created_at: '2026-05-10T00:00:00.000Z',
  });

  expect(event.payload).toEqual({
    work_item_id: 'work-item-1',
    required_check_ids: ['contracts', 'api'],
  });
  expect(JSON.stringify(event)).not.toContain('secret');
  expect(JSON.stringify(event)).not.toContain('/Users/');
});
```

- [x] **Step 2: Run serializer tests to verify failure**

Run:

```bash
pnpm vitest run tests/db/public-evidence-serialization.test.ts
```

Expected: FAIL because the serializer module does not exist.

- [x] **Step 3: Add db dependency and export placeholder**

Modify `packages/db/package.json`:

```json
"dependencies": {
  "@forgeloop/contracts": "workspace:*",
  "@forgeloop/domain": "workspace:*",
  "drizzle-orm": "^0.45.2",
  "pg": "^8.20.0",
  "zod": "^4.4.3"
}
```

Modify `packages/db/src/index.ts`:

```ts
export * from './queries/public-evidence-serialization';
```

- [x] **Step 4: Update lockfile**

Run:

```bash
pnpm install --lockfile-only
```

Expected: PASS and `pnpm-lock.yaml` records `packages/db` depending on `@forgeloop/contracts`.

- [x] **Step 5: Implement serializer module**

Create `packages/db/src/queries/public-evidence-serialization.ts`.

Implementation boundaries:
- Import public schemas/types and helpers from `@forgeloop/contracts`.
- Import domain row types from `@forgeloop/domain`.
- Do not import API code.
- Do not copy raw rows and delete fields afterward. Construct fresh public objects.

Required exported functions:

```ts
export type SerializePublicReleaseEvidenceInput = {
  evidence: ReleaseEvidence;
  artifact?: Artifact | ArtifactRef;
};

export type ReplaySerializationInput =
  | {
      id: string;
      source: 'object_event';
      object_type: string;
      object_id: string;
      summary: string;
      created_at: string;
      payload: ObjectEvent;
    }
  | {
      id: string;
      source: 'status_history';
      object_type: string;
      object_id: string;
      summary: string;
      created_at: string;
      payload: StatusHistory;
    }
  | {
      id: string;
      source: 'decision';
      object_type: string;
      object_id: string;
      summary: string;
      created_at: string;
      payload: Decision;
    }
  | {
      id: string;
      source: 'artifact';
      object_type: string;
      object_id: string;
      summary: string;
      created_at: string;
      payload: ArtifactRef;
    }
  | {
      id: string;
      source: 'release_evidence';
      object_type: string;
      object_id: string;
      summary: string;
      created_at: string;
      payload: SerializePublicReleaseEvidenceInput;
    };

export const artifactRedactionReason = (artifact: ArtifactRef): EvidenceChainRedactionReason | undefined => { /* ... */ };
export const serializePublicArtifactRef = (artifact: ArtifactRef): PublicArtifactRef | undefined => { /* ... */ };
export const serializePublicArtifactRefs = (artifacts: readonly ArtifactRef[]): PublicArtifactRef[] => { /* ... */ };
export const serializePublicDecision = (decision: Decision): PublicDecision => { /* ... */ };
export const serializePublicObjectEvent = (objectEvent: ObjectEvent): PublicObjectEvent => { /* ... */ };
export const serializePublicStatusHistory = (statusHistory: StatusHistory): PublicStatusHistory => { /* ... */ };
export const serializePublicReleaseEvidence = (input: SerializePublicReleaseEvidenceInput): PublicReleaseEvidence => { /* ... */ };
export const serializePublicReplayPayload = (source: PublicReplayEntry['source'], payload: unknown): PublicReplayEntry['payload'] => { /* ... */ };
export const serializePublicReplayEntry = (entry: ReplaySerializationInput): PublicReplayEntry => { /* ... */ };
```

Implementation rules:
- For artifacts:
  - `logs` -> `logs_artifact`
  - `raw_metadata` -> `raw_metadata_artifact`
  - any `raw_ref` -> `raw_ref`
  - no public `storage_uri` and has only `local_ref` -> `local_ref_only`
  - non-public `storage_uri` -> `unsafe_storage_uri`
- For allowed object-event/status-history fields:
  - include only valid values;
  - filter array values to valid strings/public artifact kinds;
  - omit malformed optional fields;
  - default payload/context to `{}`.
- For ReleaseEvidence:
  - omit unsafe or malformed `extra` groups;
  - preserve `artifact_id`;
  - include `artifact` only if `serializePublicArtifactRef()` returns a value;
  - default `extra` to `{}`.
- Parse final return values with the matching strict public schema.

- [x] **Step 6: Run serializer tests to verify pass**

Run:

```bash
pnpm vitest run tests/db/public-evidence-serialization.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit serializer**

```bash
git add packages/db/package.json pnpm-lock.yaml packages/db/src tests/db/public-evidence-serialization.test.ts
git commit -m "feat: share public evidence serialization"
```

## Task 3: Wire Public Serializer Into Replay Queries

**Files:**
- Modify: `packages/db/src/queries/replay-queries.ts`
- Modify: `tests/api/query-module.test.ts`

- [x] **Step 1: Write failing replay API leakage test**

In `tests/api/query-module.test.ts`, add a test that seeds unsafe ObjectEvent/StatusHistory/Decision/Artifact rows and asserts `/query/replay/work_item/:id` returns only public payloads.

Use the existing `createTestApp()` helper and `seedReadyExecutionPackageThroughApi(app)`.

Test outline:

```ts
it('serializes replay payloads through the public evidence boundary', async () => {
  const { app, repo } = await track(createTestApp());
  const executionPackage = await seedReadyExecutionPackageThroughApi(app);
  const workItemId = executionPackage.work_item_id;
  const createdAt = '2026-05-10T00:00:00.000Z';

  await repo.appendObjectEvent({
    id: 'object-event-public-boundary',
    object_type: 'work_item',
    object_id: workItemId,
    event_type: 'work_item_public_boundary',
    actor_type: 'system',
    actor_id: 'actor-system',
    reason: 'test',
    metadata: { internal_payload: 'not public' },
    payload: {
      work_item_id: workItemId,
      required_check_ids: ['contracts', 123],
      accessToken: 'secret',
      output_path: '/Users/viv/out.log',
      unknown: 'drop me',
    },
    created_at: createdAt,
  });
  await repo.appendStatusHistory({
    id: 'status-history-public-boundary',
    object_type: 'work_item',
    object_id: workItemId,
    to_status: 'ready',
    context: {
      work_item_id: workItemId,
      failed_check_ids: ['api', false],
      client_secret: 'secret',
      path: 'artifacts/run/out.log',
    },
    created_at: createdAt,
  });
  await repo.saveDecision({
    id: 'decision-public-boundary',
    object_type: 'work_item',
    object_id: workItemId,
    actor_id: 'actor-reviewer',
    decision: 'approved',
    summary: 'Approved',
    evidence_refs: { raw_ref: 'local://decision/raw.json' },
    created_at: createdAt,
  });
  await repo.saveArtifact({
    id: 'artifact-unsafe-uri',
    object_type: 'work_item',
    object_id: workItemId,
    ref: {
      kind: 'diff',
      name: 'Unsafe patch',
      content_type: 'text/x-patch',
      storage_uri: 'https://example.test/out.patch?token=secret',
    },
    created_at: createdAt,
  });

  const response = await request(app.getHttpServer()).get(`/query/replay/work_item/${workItemId}`).expect(200);
  const serialized = JSON.stringify(response.body);

  expect(serialized).not.toContain('accessToken');
  expect(serialized).not.toContain('client_secret');
  expect(serialized).not.toContain('/Users/');
  expect(serialized).not.toContain('artifacts/run/out.log');
  expect(serialized).not.toContain('raw_ref');
  expect(serialized).not.toContain('token=secret');

  expect(response.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'object-event-public-boundary',
        source: 'object_event',
        payload: expect.objectContaining({
          payload: { work_item_id: workItemId, required_check_ids: ['contracts'] },
        }),
      }),
      expect.objectContaining({
        id: 'status-history-public-boundary',
        source: 'status_history',
        payload: expect.objectContaining({
          context: { work_item_id: workItemId, failed_check_ids: ['api'] },
        }),
      }),
      expect.objectContaining({
        id: 'decision-public-boundary',
        source: 'decision',
        payload: expect.not.objectContaining({ evidence_refs: expect.anything() }),
      }),
    ]),
  );
});
```

- [x] **Step 2: Run replay API test to verify failure**

Run:

```bash
pnpm vitest run tests/api/query-module.test.ts
```

Expected: FAIL because replay currently returns raw Decision/ObjectEvent/StatusHistory payloads and local artifact redaction is incomplete.

- [x] **Step 3: Replace replay query serialization**

Modify `packages/db/src/queries/replay-queries.ts`:
- remove local `artifactRedactionReason`;
- remove local `serializePublicArtifactRef`;
- import `serializePublicArtifactRef` and `serializePublicReplayEntry` from `./public-evidence-serialization`;
- type entries as `PublicReplayEntry[]`;
- construct each replay entry through `serializePublicReplayEntry()`;
- keep current work-item object traversal and chronological sorting.

Important behavior:
- Artifact entries whose ref serializes to `undefined` should be omitted.
- ObjectEvent/StatusHistory/Decision entries should remain in the timeline with sanitized public payloads.
- Unsupported object types still return `undefined`; QueryService still converts that to 400/404 as it does today.

- [x] **Step 4: Run replay API tests to verify pass**

Run:

```bash
pnpm vitest run tests/api/query-module.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit replay wiring**

```bash
git add packages/db/src/queries/replay-queries.ts tests/api/query-module.test.ts
git commit -m "feat: serialize replay payloads publicly"
```

## Task 4: Wire Shared Artifact Serialization Into Evidence Chain And Run Session Output

**Files:**
- Modify: `apps/control-plane-api/src/p0/evidence-chain.ts`
- Modify: `apps/control-plane-api/src/p0/run-session-serialization.ts`
- Modify: `tests/api/evidence-chain.test.ts`
- Create: `tests/api/run-session-serialization.test.ts`

- [x] **Step 1: Write failing Evidence Chain unsafe URI test**

In `tests/api/evidence-chain.test.ts`, add a test near `reconstructs public persisted artifact rows without local refs`:

```ts
it('redacts persisted artifact rows with unsafe storage URIs', async () => {
  const { app, repo, workItemId } = await track(seedEvidenceChainScenario());
  await repo.saveArtifact({
    id: 'artifact-unsafe-storage-uri',
    object_type: 'run_session',
    object_id: 'run-session-approved',
    ref: {
      kind: 'diff',
      name: 'Unsafe public diff',
      content_type: 'text/x-patch',
      storage_uri: 'https://example.test/diff.patch?token=secret',
    },
    created_at: '2026-05-05T00:05:03.000Z',
  });

  const response = await request(app.getHttpServer()).get(`/work-items/${workItemId}/evidence-chain`).expect(200);
  const chain = evidenceChainResponseSchema.parse(response.body);
  const serialized = JSON.stringify(chain);

  expect(chain.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'evidence-item:redacted-artifact-record:artifact-unsafe-storage-uri',
        source: 'artifact',
        redacted: true,
        details: expect.objectContaining({ redaction_reason: 'unsafe_storage_uri' }),
      }),
    ]),
  );
  expect(serialized).not.toContain('token=secret');
  expect(serialized).not.toContain('details":{"artifact"');
});
```

- [x] **Step 2: Write failing run-session serialization test**

Create `tests/api/run-session-serialization.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { serializePublicRunSession } from '../../apps/control-plane-api/src/p0/run-session-serialization';
import type { RunSession } from '@forgeloop/domain';

describe('run session public serialization', () => {
  it('uses shared public artifact serialization for artifacts and check outputs', () => {
    const runSession: RunSession = {
      id: 'run-session-1',
      execution_package_id: 'package-1',
      requested_by_actor_id: 'actor-1',
      status: 'succeeded',
      executor_type: 'mock',
      changed_files: [],
      artifacts: [
        {
          kind: 'diff',
          name: 'Patch',
          content_type: 'text/x-patch',
          storage_uri: 's3://bucket/diff.patch',
          local_ref: 'artifacts/run/diff.patch',
        },
        {
          kind: 'diff',
          name: 'Unsafe',
          content_type: 'text/x-patch',
          storage_uri: 'https://example.test/diff.patch?token=secret',
        },
      ],
      log_refs: [
        {
          kind: 'logs',
          name: 'Logs',
          content_type: 'text/plain',
          local_ref: 'artifacts/run/logs.txt',
        },
      ],
      check_results: [
        {
          check_id: 'contracts',
          command: 'pnpm vitest run tests/contracts',
          status: 'succeeded',
          exit_code: 0,
          duration_seconds: 1,
          blocks_review: true,
          stdout: {
            kind: 'check_output',
            name: 'stdout',
            content_type: 'text/plain',
            storage_uri: 'file:///Users/viv/stdout.txt',
          },
          stderr: {
            kind: 'check_output',
            name: 'stderr',
            content_type: 'text/plain',
            storage_uri: 'https://example.test/stderr.txt?token=secret',
          },
        },
      ],
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:01.000Z',
    };

    const serialized = serializePublicRunSession(runSession);
    expect(serialized.artifacts).toEqual([
      {
        kind: 'diff',
        name: 'Patch',
        content_type: 'text/x-patch',
        storage_uri: 's3://bucket/diff.patch',
      },
    ]);
    expect(serialized.log_refs).toEqual([]);
    expect(serialized.check_results[0]).not.toHaveProperty('stdout');
    expect(serialized.check_results[0]).not.toHaveProperty('stderr');
    expect(JSON.stringify(serialized)).not.toContain('token=secret');
    expect(JSON.stringify(serialized)).not.toContain('local_ref');
  });
});
```

- [x] **Step 3: Run focused API tests to verify failure**

Run:

```bash
pnpm vitest run tests/api/evidence-chain.test.ts tests/api/run-session-serialization.test.ts
```

Expected: FAIL because API code still imports artifact serialization from `run-session-serialization.ts`, and that implementation does not know `unsafe_storage_uri` or the stricter public `storage_uri` rules for stdout/stderr.

- [x] **Step 4: Update Evidence Chain imports**

Modify `apps/control-plane-api/src/p0/evidence-chain.ts`:

```ts
import { artifactRedactionReason, serializePublicArtifactRef } from '@forgeloop/db';
```

Remove the old import from `./run-session-serialization`.

Do not add `details.artifact`; keep safe artifact items as subject/summary/links/risk flags only.

- [x] **Step 5: Update run-session serialization**

Modify `apps/control-plane-api/src/p0/run-session-serialization.ts`:
- remove local `artifactRedactionReason`;
- remove local `serializePublicArtifactRef`;
- remove local `serializePublicArtifactRefs`;
- import `serializePublicArtifactRef` and `serializePublicArtifactRefs` from `@forgeloop/db`;
- keep run-session-specific logic for `run_spec`, `runtime_metadata`, `log_refs`, and `executor_result.raw_metadata`.

Because `serializePublicArtifactRef()` returns `PublicArtifactRef`, update local types where needed. If TypeScript rejects assigning `PublicArtifactRef[]` to `RunSession['artifacts']`, introduce local public run-session return types and update the `P0Service.getRunSession()` return annotation instead of weakening the shared serializer.

- [x] **Step 6: Run focused API tests to verify pass**

Run:

```bash
pnpm vitest run tests/api/evidence-chain.test.ts tests/api/run-session-serialization.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit API integration**

```bash
git add apps/control-plane-api/src/p0/evidence-chain.ts apps/control-plane-api/src/p0/run-session-serialization.ts tests/api/evidence-chain.test.ts tests/api/run-session-serialization.test.ts
git commit -m "feat: reuse public artifact serialization in api"
```

## Task 5: Full Verification And Cleanup

**Files:**
- Review: `packages/contracts/src/public-evidence.ts`
- Review: `packages/db/src/queries/public-evidence-serialization.ts`
- Review: `packages/db/src/queries/replay-queries.ts`
- Review: `apps/control-plane-api/src/p0/evidence-chain.ts`
- Review: `apps/control-plane-api/src/p0/run-session-serialization.ts`

- [x] **Step 1: Search for duplicate artifact redaction implementations**

Run:

```bash
rg -n "artifactRedactionReason|serializePublicArtifactRef|raw_ref|local_ref_only|unsafe_storage_uri" packages apps tests
```

Expected:
- `artifactRedactionReason` is implemented only in `packages/db/src/queries/public-evidence-serialization.ts`.
- API code imports serializer helpers from `@forgeloop/db`.
- Tests may reference the names.

- [x] **Step 2: Run all targeted tests**

Run:

```bash
pnpm vitest run tests/contracts/public-evidence.test.ts tests/contracts/evidence-chain.test.ts tests/db/public-evidence-serialization.test.ts tests/api/query-module.test.ts tests/api/evidence-chain.test.ts tests/api/run-session-serialization.test.ts
```

Expected: PASS.

- [x] **Step 3: Run package builds**

Run:

```bash
pnpm install --frozen-lockfile
pnpm --filter @forgeloop/contracts build
pnpm --filter @forgeloop/db build
pnpm --filter @forgeloop/control-plane-api build
```

Expected: PASS.

- [x] **Step 4: Run the full test suite if targeted verification passes**

Run:

```bash
pnpm test
```

Expected: PASS.

- [x] **Step 5: Update plan checkboxes**

Mark completed checklist items in this plan only after the commands above pass.

- [x] **Step 6: Commit cleanup**

```bash
git add docs/superpowers/plans/2026-05-10-public-evidence-serialization.md packages/contracts packages/db apps/control-plane-api/src/p0 tests pnpm-lock.yaml
git commit -m "test: verify public evidence serialization"
```

Expected: working tree clean and all relevant tests passing.
