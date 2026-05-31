import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { codexCanonicalDigest } from '@forgeloop/domain';
import { afterEach, describe, expect, it } from 'vitest';

import {
  InMemoryDeliveryRepository,
  LocalInternalArtifactStore,
  type DeliveryRepository,
  type GetInternalArtifactObjectByRefInput,
  type InternalArtifactObject,
  type PutInternalArtifactObjectInput,
} from '../../packages/db/src/index';

const tempRoots: string[] = [];
const now = '2026-05-30T00:00:00.000Z';

const sha256Digest = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const makeTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'forgeloop-local-internal-artifacts-'));
  tempRoots.push(root);
  return root;
};

const inputFor = (
  bytes: Uint8Array,
  overrides: Partial<PutInternalArtifactObjectInput> = {},
): PutInternalArtifactObjectInput => ({
  artifact_id: 'artifact-1',
  kind: 'codex_runtime_job_artifact',
  owner_type: 'codex_runtime_job',
  owner_id: 'runtime-job-1',
  visibility: 'internal',
  content_type: 'application/json',
  declared_size_bytes: String(bytes.byteLength),
  declared_artifact_digest: sha256Digest(bytes),
  idempotency_key: 'idem-1',
  metadata_json: { schema_version: 'test.v1' },
  created_by_actor_type: 'codex_worker',
  created_by_actor_id: 'worker-1',
  now,
  max_size_bytes: 1024 * 1024,
  bytes,
  ...overrides,
});

const makeStore = async (
  repository: DeliveryRepository = new InMemoryDeliveryRepository(),
  requestId = 'request-1',
): Promise<{ root: string; repository: DeliveryRepository; store: LocalInternalArtifactStore }> => {
  const root = await makeTempRoot();
  return {
    root,
    repository,
    store: new LocalInternalArtifactStore({ root, repository, requestId }),
  };
};

class ConcurrentReplayRepository extends InMemoryDeliveryRepository {
  private waiters: Array<() => void> = [];

  override async getInternalArtifactObjectByRef(
    input: GetInternalArtifactObjectByRefInput,
  ): Promise<InternalArtifactObject | undefined> {
    if (input.ref.endsWith('/artifact-1') && this.waiters.length < 2) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        if (this.waiters.length === 2) {
          for (const waiter of this.waiters) {
            waiter();
          }
        }
      });
    }
    return super.getInternalArtifactObjectByRef(input);
  }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('LocalInternalArtifactStore', () => {
  it('writes bytes under content-addressed storage and replays idempotently', async () => {
    const bytes = Buffer.from('{"ok":true}', 'utf8');
    const { root, store } = await makeStore();
    const input = inputFor(bytes);

    const artifact = await store.putObject(input);
    const replayed = await store.putObject(input);

    expect(replayed).toEqual(artifact);
    expect(artifact.ref).toBe(
      'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/artifact-1',
    );
    expect(artifact.storage_key).toBe(
      `objects/sha256/${artifact.digest.slice('sha256:'.length, 'sha256:'.length + 2)}/${artifact.digest.slice('sha256:'.length)}`,
    );
    expect(artifact.storage_key).not.toContain(root);
    await expect(readFile(join(root, artifact.storage_key))).resolves.toEqual(bytes);
    const objectStat = await lstat(join(root, artifact.storage_key));
    expect(objectStat.isSymbolicLink()).toBe(false);
    expect(objectStat.isFile()).toBe(true);
  });

  it('preserves the caller supplied creation time for new uploads', async () => {
    const bytes = Buffer.from('created at should be real upload time', 'utf8');
    const { store } = await makeStore();

    const artifact = await store.putObject(inputFor(bytes, { now: '2026-05-30T09:30:00.000Z' }));

    expect(artifact.created_at).toBe('2026-05-30T09:30:00.000Z');
  });

  it('replays identical concurrent putObject calls without id drift', async () => {
    const bytes = Buffer.from('concurrent bytes', 'utf8');
    const { store } = await makeStore(new ConcurrentReplayRepository());
    const input = inputFor(bytes);

    const [left, right] = await Promise.all([store.putObject(input), store.putObject(input)]);

    expect(left).toEqual(right);
    expect(left.ref).toBe('artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/artifact-1');
    expect(left.request_digest).toBe(right.request_digest);
  });

  it('replays identical concurrent putObject calls with different now values', async () => {
    const bytes = Buffer.from('concurrent different now', 'utf8');
    const { store } = await makeStore(new ConcurrentReplayRepository());
    const input = inputFor(bytes);

    const [left, right] = await Promise.all([
      store.putObject(input),
      store.putObject({ ...input, now: '2026-05-30T02:00:00.000Z' }),
    ]);

    expect(left).toEqual(right);
    expect(left.ref).toBe(right.ref);
    expect(left.request_digest).toBe(right.request_digest);
    expect(left.created_at).toBe(right.created_at);
  });

  it('getObject reads bytes and metadata', async () => {
    const bytes = Buffer.from('payload bytes', 'utf8');
    const { store } = await makeStore();
    const artifact = await store.putObject(inputFor(bytes, { content_type: 'text/plain' }));

    const read = await store.getObject(artifact.ref);

    expect(read.artifact).toMatchObject({
      ref: artifact.ref,
      content_type: 'text/plain',
      size_bytes: String(bytes.byteLength),
      digest: sha256Digest(bytes),
    });
    expect(read.bytes).toEqual(bytes);
    expect(read.artifact).not.toHaveProperty('absolute_path');
  });

  it('statObject returns metadata without bytes', async () => {
    const bytes = Buffer.from('metadata only', 'utf8');
    const { store } = await makeStore();
    const artifact = await store.putObject(inputFor(bytes));

    const stat = await store.statObject(artifact.ref);

    expect(stat).toEqual(artifact);
    expect(stat).not.toHaveProperty('bytes');
    expect(stat.storage_key).not.toMatch(/^\//);
  });

  it('deleteObject tombstones metadata and hides future reads and stats', async () => {
    const bytes = Buffer.from('delete me', 'utf8');
    const { store } = await makeStore();
    const artifact = await store.putObject(inputFor(bytes));

    const deleted = await store.deleteObject(artifact.ref, '2026-05-30T01:00:00.000Z');

    expect(deleted.deleted_at).toBe('2026-05-30T01:00:00.000Z');
    await expect(store.getObject(artifact.ref)).rejects.toThrow(/internal_artifact_not_found/);
    await expect(store.statObject(artifact.ref)).rejects.toThrow(/internal_artifact_not_found/);
  });

  it('rejects idempotency drift when canonical request fields change', async () => {
    const bytes = Buffer.from('same bytes', 'utf8');
    const { store } = await makeStore();
    await store.putObject(inputFor(bytes));

    await expect(
      store.putObject(
        inputFor(bytes, {
          content_type: 'application/octet-stream',
        }),
      ),
    ).rejects.toThrow(/internal_artifact_idempotency_drift/);
  });

  it('rejects digest mismatch and size mismatch', async () => {
    const bytes = Buffer.from('checked bytes', 'utf8');
    const { store } = await makeStore();

    await expect(
      store.putObject(
        inputFor(bytes, {
          declared_artifact_digest: `sha256:${'0'.repeat(64)}`,
        }),
      ),
    ).rejects.toThrow(/internal_artifact_digest_mismatch/);

    await expect(
      store.putObject(
        inputFor(bytes, {
          artifact_id: 'artifact-2',
          idempotency_key: 'idem-2',
          declared_size_bytes: String(bytes.byteLength + 1),
        }),
      ),
    ).rejects.toThrow(/internal_artifact_size_mismatch/);
  });

  it('rejects objects over max_size_bytes', async () => {
    const bytes = Buffer.from('too large', 'utf8');
    const { store } = await makeStore();

    await expect(store.putObject(inputFor(bytes, { max_size_bytes: bytes.byteLength - 1 }))).rejects.toThrow(
      /internal_artifact_max_size_exceeded/,
    );
  });

  it('reuses content-addressed bytes for same digest and different owner when metadata allows it', async () => {
    const bytes = Buffer.from('shared content', 'utf8');
    const repository = new InMemoryDeliveryRepository();
    const first = await makeStore(repository, 'request-1');
    const second = new LocalInternalArtifactStore({ root: first.root, repository, requestId: 'request-2' });

    const firstArtifact = await first.store.putObject(inputFor(bytes));
    const secondArtifact = await second.putObject(
      inputFor(bytes, {
        artifact_id: 'artifact-2',
        owner_id: 'runtime-job-2',
        idempotency_key: 'idem-2',
      }),
    );

    expect(secondArtifact.storage_key).toBe(firstArtifact.storage_key);
    expect(secondArtifact.ref).not.toBe(firstArtifact.ref);
    await expect(readFile(join(first.root, firstArtifact.storage_key))).resolves.toEqual(bytes);
  });

  it('rejects path traversal refs before touching storage', async () => {
    const bytes = Buffer.from('unsafe ref', 'utf8');
    const { store } = await makeStore();

    await expect(
      store.getObject('artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/../artifact'),
    ).rejects.toThrow();
    await expect(
      store.putObject(
        inputFor(bytes, {
          artifact_id: '../artifact',
        }),
      ),
    ).rejects.toThrow();
  });

  it('denies symlinked store roots and object path components', async () => {
    const bytes = Buffer.from('symlink hardening', 'utf8');
    const outside = await makeTempRoot();
    const symlinkRootParent = await makeTempRoot();
    const symlinkRoot = join(symlinkRootParent, 'store-link');
    await symlink(outside, symlinkRoot, 'dir');

    const symlinkRootStore = new LocalInternalArtifactStore({
      root: symlinkRoot,
      repository: new InMemoryDeliveryRepository(),
      requestId: 'request-root-link',
    });
    await expect(symlinkRootStore.putObject(inputFor(bytes))).rejects.toThrow(/internal_artifact_storage_symlink/);

    const componentRoot = await makeTempRoot();
    await mkdir(join(componentRoot, 'tmp'), { recursive: true });
    await symlink(outside, join(componentRoot, 'objects'), 'dir');
    const componentStore = new LocalInternalArtifactStore({
      root: componentRoot,
      repository: new InMemoryDeliveryRepository(),
      requestId: 'request-component-link',
    });

    await expect(componentStore.putObject(inputFor(bytes))).rejects.toThrow(/internal_artifact_storage_symlink/);
  });

  it('sanitizes raw filesystem errors without leaking the absolute root path', async () => {
    const bytes = Buffer.from('root is file', 'utf8');
    const parent = await makeTempRoot();
    const rootFile = join(parent, 'artifact-root-file');
    await writeFile(rootFile, 'not a directory');
    const store = new LocalInternalArtifactStore({
      root: rootFile,
      repository: new InMemoryDeliveryRepository(),
      requestId: 'request-root-file',
    });

    await expect(store.putObject(inputFor(bytes))).rejects.toMatchObject({
      message: expect.not.stringContaining(rootFile),
    });
  });

  it('fails closed on oversized tampered object files before returning bytes', async () => {
    const bytes = Buffer.from('small', 'utf8');
    const { root, store } = await makeStore();
    const artifact = await store.putObject(inputFor(bytes));
    await writeFile(join(root, artifact.storage_key), Buffer.alloc(bytes.byteLength + 16, 7));

    await expect(store.getObject(artifact.ref)).rejects.toThrow(/internal_artifact_bytes_unavailable/);
    await expect(stat(join(root, artifact.storage_key))).resolves.toMatchObject({ size: bytes.byteLength + 16 });
  });

  it('validates non-JSON-compatible metadata before writing bytes', async () => {
    const bytes = Buffer.from('invalid metadata', 'utf8');
    const { root, store } = await makeStore();
    const digest = sha256Digest(bytes);

    await expect(
      store.putObject(
        inputFor(bytes, {
          metadata_json: { value: 1n } as unknown as Record<string, unknown>,
        }),
      ),
    ).rejects.toThrow(/internal_artifact_request_invalid/);
    await expect(lstat(join(root, `objects/sha256/${digest.slice('sha256:'.length, 'sha256:'.length + 2)}`))).rejects.toThrow();
  });

  it('fails closed when metadata exists but bytes are missing or tampered', async () => {
    const bytes = Buffer.from('tamper target', 'utf8');
    const { root, store } = await makeStore();
    const artifact = await store.putObject(inputFor(bytes));

    await rm(join(root, artifact.storage_key));
    await expect(store.getObject(artifact.ref)).rejects.toThrow(/internal_artifact_bytes_unavailable/);
    await expect(store.statObject(artifact.ref)).rejects.toThrow(/internal_artifact_bytes_unavailable/);

    const replay = await store.putObject(inputFor(bytes, { artifact_id: 'artifact-2', idempotency_key: 'idem-2' }));
    await rm(join(root, replay.storage_key));
    await mkdir(join(root, replay.storage_key), { recursive: true });
    await expect(store.getObject(replay.ref)).rejects.toThrow(/internal_artifact_bytes_unavailable/);
  });

  it('computes the exact canonical request digest required by the repository', async () => {
    const bytes = Buffer.from('canonical request', 'utf8');
    const { store } = await makeStore();
    const input = inputFor(bytes, {
      metadata_json: { z: true, a: ['ordered'] },
    });

    const artifact = await store.putObject(input);

    expect(artifact.request_digest).toBe(
      codexCanonicalDigest({
        schema_version: 'internal_artifact_request.v1',
        artifact_id: input.artifact_id,
        ref: artifact.ref,
        owner_type: input.owner_type,
        owner_id: input.owner_id,
        idempotency_key: input.idempotency_key,
        kind: input.kind,
        visibility: input.visibility,
        content_type: input.content_type,
        declared_size_bytes: input.declared_size_bytes,
        declared_artifact_digest: input.declared_artifact_digest,
        metadata_json: input.metadata_json,
      }),
    );
  });
});
