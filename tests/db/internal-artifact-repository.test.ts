import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { codexCanonicalDigest } from '@forgeloop/domain';
import {
  assertResettableDatabaseUrl,
  createDbClient,
  DrizzleDeliveryRepository,
  InMemoryDeliveryRepository,
  internal_artifact_objects,
  resetForgeloopDatabase,
  type CreateInternalArtifactObjectInput,
  type DeliveryRepository,
} from '../../packages/db/src/index';

const now = '2026-05-30T00:00:00.000Z';
const bytesDigest = 'sha256:' + 'a'.repeat(64);

const internalArtifactInput = (
  overrides: Partial<CreateInternalArtifactObjectInput> = {},
): CreateInternalArtifactObjectInput => ({
  id: '11111111-1111-4111-8111-111111111111',
  artifact_id: 'artifact-1',
  ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/artifact-1',
  storage_key: 'objects/sha256/aa/' + 'a'.repeat(64),
  kind: 'codex_runtime_job_artifact',
  content_type: 'application/json',
  size_bytes: '12',
  digest: bytesDigest,
  visibility: 'internal',
  owner_type: 'codex_runtime_job',
  owner_id: 'runtime-job-1',
  idempotency_key: 'idem-1',
  request_digest: codexCanonicalDigest({ request: 'same' }),
  metadata_json: {},
  created_by_actor_type: 'codex_worker',
  created_by_actor_id: 'worker-1',
  created_at: now,
  ...overrides,
});

const runInternalArtifactRepositoryContract = async (repository: DeliveryRepository) => {
  const input = internalArtifactInput({
    metadata_json: { schema_version: 'test.v1' },
  });

  await expect(repository.createOrReplayInternalArtifactObject(input)).resolves.toMatchObject({
    ref: input.ref,
    size_bytes: '12',
  });
  await expect(repository.createOrReplayInternalArtifactObject(input)).resolves.toMatchObject({
    ref: input.ref,
    size_bytes: '12',
  });

  await expect(repository.getInternalArtifactObjectByRef({ ref: input.ref })).resolves.toMatchObject({
    id: input.id,
    ref: input.ref,
    size_bytes: '12',
  });
  await expect(repository.getInternalArtifactObjectById(input.id)).resolves.toMatchObject({
    id: input.id,
    ref: input.ref,
    size_bytes: '12',
  });

  await repository.tombstoneInternalArtifactObject({ ref: input.ref, deleted_at: '2026-05-30T01:00:00.000Z' });
  await expect(repository.getInternalArtifactObjectByRef({ ref: input.ref })).resolves.toBeUndefined();
  await expect(repository.getInternalArtifactObjectById(input.id)).resolves.toBeUndefined();
  await expect(repository.getInternalArtifactObjectByRef({ ref: input.ref, include_deleted: true })).resolves.toMatchObject({
    id: input.id,
    deleted_at: '2026-05-30T01:00:00.000Z',
    size_bytes: '12',
  });
};

const runInternalArtifactConflictContract = async (repository: DeliveryRepository) => {
  const base = internalArtifactInput();
  await repository.createOrReplayInternalArtifactObject(base);

  await expect(
    repository.createOrReplayInternalArtifactObject({ ...base, digest: 'sha256:' + 'b'.repeat(64) }),
  ).rejects.toThrow(/internal_artifact_idempotency_drift/);
  await expect(repository.createOrReplayInternalArtifactObject({ ...base, idempotency_key: 'idem-2' })).rejects.toThrow(
    /internal_artifact_ref_conflict/,
  );
  await expect(
    repository.createOrReplayInternalArtifactObject({
      ...base,
      id: '22222222-2222-4222-8222-222222222222',
      ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/artifact-1-conflict',
      idempotency_key: 'idem-2',
      request_digest: codexCanonicalDigest({ request: 'different' }),
    }),
  ).rejects.toThrow(/internal_artifact_ref_mismatch/);

  await expect(
    repository.createOrReplayInternalArtifactObject({
      ...base,
      id: '22222222-2222-4222-8222-222222222222',
      metadata_json: { drift: true },
    }),
  ).rejects.toThrow(/internal_artifact_idempotency_drift/);
};

const seedOwnerKindArtifactDrift = async (repository: DeliveryRepository) => {
  const input = internalArtifactInput();
  await repository.createOrReplayInternalArtifactObject(input);
  const internalObjects = (repository as unknown as { internalArtifactObjects: Map<string, CreateInternalArtifactObjectInput> })
    .internalArtifactObjects;
  const internalObjectRefs = (repository as unknown as { internalArtifactObjectRefs: Map<string, string> }).internalArtifactObjectRefs;
  const stored = internalObjects.get(input.id);
  if (stored === undefined) {
    throw new Error('expected seeded internal artifact object');
  }
  internalObjectRefs.delete(input.ref);
  internalObjects.set(input.id, {
    ...stored,
    ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/legacy-corrupt-ref',
    idempotency_key: 'legacy-idem-drift',
  });

  await expect(
    repository.createOrReplayInternalArtifactObject({
      ...input,
      id: '22222222-2222-4222-8222-222222222222',
    }),
  ).rejects.toThrow(/internal_artifact_owner_kind_artifact_conflict/);
};

const runInternalArtifactValidationContract = async (repository: DeliveryRepository) => {
  await expect(
    repository.createOrReplayInternalArtifactObject(
      internalArtifactInput({
        artifact_id: 'artifact-2',
      }),
    ),
  ).rejects.toThrow(/internal_artifact_ref_mismatch/);

  await expect(
    repository.createOrReplayInternalArtifactObject(
      internalArtifactInput({
        owner_type: 'run_session',
      }),
    ),
  ).rejects.toThrow(/internal_artifact_ref_mismatch/);

  for (const size_bytes of ['-1', '1.5', 'abc']) {
    const artifact_id = `artifact-invalid-size-${size_bytes.replace('.', '-')}`;
    await expect(
      repository.createOrReplayInternalArtifactObject(
        internalArtifactInput({
          id: `11111111-1111-4111-8111-${size_bytes === '-1' ? '222222222222' : size_bytes === '1.5' ? '333333333333' : '444444444444'}`,
          artifact_id,
          ref: `artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/${artifact_id}`,
          idempotency_key: `idem-invalid-size-${size_bytes.replace('.', '-')}`,
          size_bytes,
        }),
      ),
    ).rejects.toThrow(/internal_artifact_invalid_size_bytes/);
  }
};

describe('Internal artifact repository', () => {
  it('creates, replays, looks up, and tombstones internal artifact metadata', async () => {
    await runInternalArtifactRepositoryContract(new InMemoryDeliveryRepository());
  });

  it('rejects idempotency drift, ref conflicts, and owner kind artifact conflicts', async () => {
    await runInternalArtifactConflictContract(new InMemoryDeliveryRepository());
  });

  it('rejects owner kind artifact conflicts before insert when an existing row drifted', async () => {
    await seedOwnerKindArtifactDrift(new InMemoryDeliveryRepository());
  });

  it('rejects decomposed ref mismatches and invalid size strings', async () => {
    await runInternalArtifactValidationContract(new InMemoryDeliveryRepository());
  });
});

describe('Internal artifact repository Drizzle adapter', () => {
  const databaseUrl = process.env.FORGELOOP_TEST_DATABASE_URL?.trim() || process.env.FORGELOOP_DATABASE_URL?.trim() || undefined;

  const isResettable = (url: string): boolean => {
    try {
      assertResettableDatabaseUrl(url);
      return true;
    } catch {
      return false;
    }
  };

  if (databaseUrl === undefined) {
    it.skip('skips Drizzle internal artifact repository coverage because no disposable database URL is configured', () => {});
  } else if (!isResettable(databaseUrl)) {
    it.skip('skips Drizzle internal artifact repository coverage because configured database URL is not resettable', () => {});
  } else {
    it('matches the internal artifact repository contract', async () => {
      await resetForgeloopDatabase(databaseUrl);
      const { db, pool } = createDbClient({ connectionString: databaseUrl });
      try {
        const repository = new DrizzleDeliveryRepository(db);
        await runInternalArtifactRepositoryContract(repository);
      } finally {
        await pool.end();
      }
    });

    it('matches internal artifact conflict and validation behavior', async () => {
      await resetForgeloopDatabase(databaseUrl);
      const { db, pool } = createDbClient({ connectionString: databaseUrl });
      try {
        const repository = new DrizzleDeliveryRepository(db);
        await runInternalArtifactConflictContract(repository);
        await resetForgeloopDatabase(databaseUrl);
        await runInternalArtifactValidationContract(repository);
      } finally {
        await pool.end();
      }
    });

    it('query-first rejects owner kind artifact conflicts before insert', async () => {
      await resetForgeloopDatabase(databaseUrl);
      const { db, pool } = createDbClient({ connectionString: databaseUrl });
      try {
        const repository = new DrizzleDeliveryRepository(db);
        const input = internalArtifactInput();
        await repository.createOrReplayInternalArtifactObject(input);
        await db
          .update(internal_artifact_objects)
          .set({
            ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/legacy-corrupt-ref',
            idempotencyKey: 'legacy-idem-drift',
          })
          .where(eq(internal_artifact_objects.id, input.id));
        await expect(
          repository.createOrReplayInternalArtifactObject({
            ...input,
            id: '22222222-2222-4222-8222-222222222222',
          }),
        ).rejects.toThrow(/internal_artifact_owner_kind_artifact_conflict/);
      } finally {
        await pool.end();
      }
    });
  }
});
