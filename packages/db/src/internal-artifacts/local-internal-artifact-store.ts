import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  buildInternalArtifactRef,
  codexCanonicalDigest,
  DomainError,
  parseInternalArtifactRef,
  type InternalArtifactObject,
} from '@forgeloop/domain';

import type {
  InternalArtifactMetadataRepository,
  InternalArtifactObjectRead,
  LocalInternalArtifactStoreOptions,
  PutInternalArtifactObjectInput,
} from './types';

const digestPrefix = 'sha256:';
const sha256HexPattern = /^[0-9a-f]{64}$/;
const decimalSizePattern = /^(0|[1-9][0-9]*)$/;
const requestIdSafePattern = /^[A-Za-z0-9_.-]+$/;

interface InitializedStore {
  root: string;
}

const storeError = (reason: string): DomainError => new DomainError('codex_runtime_job_unavailable', reason);

const rawSha256 = (bytes: Uint8Array): string => `${digestPrefix}${createHash('sha256').update(bytes).digest('hex')}`;

const deterministicArtifactObjectId = (ref: string, idempotencyKey: string): string => {
  const hex = createHash('sha256').update(`internal-artifact-object-id:${ref}:${idempotencyKey}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const parseDeclaredSize = (value: string): number => {
  if (!decimalSizePattern.test(value)) {
    throw storeError('internal_artifact_invalid_size_bytes');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw storeError('internal_artifact_invalid_size_bytes');
  }
  return parsed;
};

const parseDeclaredDigestHex = (value: string): string => {
  if (!value.startsWith(digestPrefix)) {
    throw storeError('internal_artifact_invalid_digest');
  }
  const hex = value.slice(digestPrefix.length);
  if (!sha256HexPattern.test(hex)) {
    throw storeError('internal_artifact_invalid_digest');
  }
  return hex;
};

const ensureRelativeStorageKey = (storageKey: string): void => {
  if (isAbsolute(storageKey) || storageKey.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw storeError('internal_artifact_storage_key_invalid');
  }
};

const safeRequestIdSegment = (requestId: string): string =>
  requestIdSafePattern.test(requestId) ? requestId : createHash('sha256').update(requestId).digest('hex');

export class LocalInternalArtifactStore {
  private initialized?: Promise<InitializedStore>;

  constructor(private readonly options: LocalInternalArtifactStoreOptions) {}

  async putObject(input: PutInternalArtifactObjectInput): Promise<InternalArtifactObject> {
    return this.sanitizePublicErrors('internal_artifact_storage_unavailable', async () => {
      const root = (await this.initialize()).root;
      const declaredSize = parseDeclaredSize(input.declared_size_bytes);
      const declaredDigestHex = parseDeclaredDigestHex(input.declared_artifact_digest);
      const digest = `${digestPrefix}${declaredDigestHex}`;
      if (!Number.isSafeInteger(input.max_size_bytes) || input.max_size_bytes < 0) {
        throw storeError('internal_artifact_invalid_max_size_bytes');
      }
      if (input.bytes.byteLength !== declaredSize) {
        throw storeError('internal_artifact_size_mismatch');
      }
      if (input.bytes.byteLength > input.max_size_bytes) {
        throw storeError('internal_artifact_max_size_exceeded');
      }
      if (rawSha256(input.bytes) !== digest) {
        throw storeError('internal_artifact_digest_mismatch');
      }

      const ref = buildInternalArtifactRef({
        kind: input.kind,
        owner_type: input.owner_type,
        owner_id: input.owner_id,
        artifact_id: input.artifact_id,
      });
      const requestPayload = {
        schema_version: 'internal_artifact_request.v1',
        artifact_id: input.artifact_id,
        ref,
        owner_type: input.owner_type,
        owner_id: input.owner_id,
        idempotency_key: input.idempotency_key,
        kind: input.kind,
        visibility: input.visibility,
        content_type: input.content_type,
        declared_size_bytes: input.declared_size_bytes,
        declared_artifact_digest: input.declared_artifact_digest,
        metadata_json: input.metadata_json,
      };
      const requestDigest = this.safeCanonicalDigest(requestPayload);
      const storageKey = `objects/sha256/${declaredDigestHex.slice(0, 2)}/${declaredDigestHex}`;
      const objectPath = await this.resolveStorePath(root, storageKey);

      await this.writeContentAddressedObject(root, objectPath, input.bytes, digest, declaredSize);
      const existing = await this.options.repository.getInternalArtifactObjectByRef({ ref });

      return this.options.repository.createOrReplayInternalArtifactObject({
        id: existing?.id ?? deterministicArtifactObjectId(ref, input.idempotency_key),
        artifact_id: input.artifact_id,
        ref,
        storage_key: storageKey,
        kind: input.kind,
        content_type: input.content_type,
        size_bytes: input.declared_size_bytes,
        digest,
        visibility: input.visibility,
        owner_type: input.owner_type,
        owner_id: input.owner_id,
        idempotency_key: input.idempotency_key,
        request_digest: requestDigest,
        metadata_json: input.metadata_json,
        created_by_actor_type: input.created_by_actor_type,
        created_by_actor_id: input.created_by_actor_id,
        created_at: existing?.created_at ?? input.now,
      });
    });
  }

  async getObject(ref: string): Promise<InternalArtifactObjectRead> {
    return this.sanitizePublicErrors('internal_artifact_bytes_unavailable', async () => {
      parseInternalArtifactRef(ref);
      const artifact = await this.getVisibleArtifact(ref);
      const bytes = await this.readVerifiedBytes(artifact);
      return { artifact, bytes };
    });
  }

  async statObject(ref: string): Promise<InternalArtifactObject> {
    return this.sanitizePublicErrors('internal_artifact_bytes_unavailable', async () => {
      parseInternalArtifactRef(ref);
      const artifact = await this.getVisibleArtifact(ref);
      await this.readVerifiedBytes(artifact);
      return artifact;
    });
  }

  async deleteObject(ref: string, deletedAt = new Date().toISOString()): Promise<InternalArtifactObject> {
    return this.sanitizePublicErrors('internal_artifact_storage_unavailable', async () => {
      parseInternalArtifactRef(ref);
      return this.options.repository.tombstoneInternalArtifactObject({ ref, deleted_at: deletedAt });
    });
  }

  private initialize(): Promise<InitializedStore> {
    this.initialized ??= this.initializeStore();
    return this.initialized;
  }

  private async getVisibleArtifact(ref: string): Promise<InternalArtifactObject> {
    const artifact = await this.options.repository.getInternalArtifactObjectByRef({ ref });
    if (artifact === undefined) {
      throw storeError('internal_artifact_not_found');
    }
    return artifact;
  }

  private async initializeStore(): Promise<InitializedStore> {
    await assertNoSymlinkAt(this.options.root);
    await this.safeFs(() => mkdir(this.options.root, { recursive: true, mode: 0o700 }), 'internal_artifact_storage_unavailable');
    const root = await this.safeFs(() => realpath(this.options.root), 'internal_artifact_storage_unavailable');
    await this.assertPathUnderRoot(root, root);
    // The local backend assumes this root is private to ForgeLoop, while still rejecting symlinked roots/components.
    const tmpPath = await this.resolveStorePath(root, 'tmp');
    const objectsPath = await this.resolveStorePath(root, 'objects');
    const sha256ObjectsPath = await this.resolveStorePath(root, 'objects/sha256');
    await this.safeFs(() => mkdir(tmpPath, { recursive: true, mode: 0o700 }), 'internal_artifact_storage_unavailable');
    await this.safeFs(() => mkdir(objectsPath, { recursive: true, mode: 0o700 }), 'internal_artifact_storage_unavailable');
    await this.safeFs(
      () => mkdir(sha256ObjectsPath, { recursive: true, mode: 0o700 }),
      'internal_artifact_storage_unavailable',
    );
    return { root };
  }

  private async writeContentAddressedObject(
    root: string,
    objectPath: string,
    bytes: Uint8Array,
    digest: string,
    expectedSize: number,
  ): Promise<void> {
    const existing = await this.safeObjectDigest(objectPath, expectedSize);
    if (existing !== undefined) {
      if (existing !== digest) {
        throw storeError('internal_artifact_digest_mismatch');
      }
      return;
    }

    await this.assertNoSymlinkComponents(root, dirname(objectPath));
    await this.safeFs(() => mkdir(dirname(objectPath), { recursive: true, mode: 0o700 }), 'internal_artifact_storage_unavailable');
    await this.assertNoSymlinkComponents(root, dirname(objectPath));

    const tmpDir = await this.resolveStorePath(root, `tmp/${safeRequestIdSegment(this.options.requestId)}`);
    await this.safeFs(() => mkdir(tmpDir, { recursive: true, mode: 0o700 }), 'internal_artifact_storage_unavailable');
    const tmpPath = await this.resolveStorePath(
      root,
      `tmp/${safeRequestIdSegment(this.options.requestId)}/${randomUUID()}.tmp`,
    );
    const tmpHandle = await this.safeFs(() => open(tmpPath, 'wx', 0o600), 'internal_artifact_storage_unavailable');
    try {
      await this.safeFs(() => tmpHandle.writeFile(bytes), 'internal_artifact_storage_unavailable');
      await this.safeFs(() => tmpHandle.sync(), 'internal_artifact_storage_unavailable');
    } finally {
      await this.safeFs(() => tmpHandle.close(), 'internal_artifact_storage_unavailable');
    }
    await this.assertRegularFileWithDigest(tmpPath, digest, expectedSize);

    try {
      await link(tmpPath, objectPath);
    } catch (error) {
      if (isFilesystemError(error, 'EEXIST')) {
        const existing = await this.safeObjectDigest(objectPath, expectedSize);
        if (existing !== digest) {
          throw storeError('internal_artifact_digest_mismatch');
        }
        await this.safeFs(() => rm(tmpPath, { force: true }), 'internal_artifact_storage_unavailable');
      } else {
        await this.safeFs(() => rm(tmpPath, { force: true }), 'internal_artifact_storage_unavailable');
        throw storeError('internal_artifact_storage_unavailable');
      }
    }
    await this.safeFs(() => rm(tmpPath, { force: true }), 'internal_artifact_storage_unavailable');

    await this.assertRegularFileWithDigest(objectPath, digest, expectedSize);
  }

  private async readVerifiedBytes(artifact: InternalArtifactObject): Promise<Uint8Array> {
    const root = (await this.initialize()).root;
    ensureRelativeStorageKey(artifact.storage_key);
    const objectPath = await this.resolveStorePath(root, artifact.storage_key);
    const expectedSize = parseDeclaredSize(artifact.size_bytes);
    const bytes = await this.readRegularFile(objectPath, expectedSize);
    if (rawSha256(bytes) !== artifact.digest) {
      throw storeError('internal_artifact_bytes_unavailable');
    }
    return bytes;
  }

  private async safeObjectDigest(path: string, expectedSize: number): Promise<string | undefined> {
    try {
      const pathStat = await lstat(path);
      if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
        throw storeError('internal_artifact_bytes_unavailable');
      }
      if (pathStat.size !== expectedSize) {
        throw storeError('internal_artifact_bytes_unavailable');
      }
      const bytes = await this.safeFs(() => readFile(path), 'internal_artifact_bytes_unavailable');
      return rawSha256(bytes);
    } catch (error) {
      if (isFilesystemError(error, 'ENOENT')) {
        return undefined;
      }
      if (error instanceof DomainError) {
        throw error;
      }
      throw storeError('internal_artifact_bytes_unavailable');
    }
  }

  private async assertRegularFileWithDigest(path: string, digest: string, expectedSize: number): Promise<void> {
    const bytes = await this.readRegularFile(path, expectedSize);
    if (rawSha256(bytes) !== digest) {
      throw storeError('internal_artifact_digest_mismatch');
    }
  }

  private async readRegularFile(path: string, expectedSize: number): Promise<Buffer> {
    let pathStat;
    try {
      pathStat = await lstat(path);
    } catch (error) {
      if (isFilesystemError(error, 'ENOENT')) {
        throw storeError('internal_artifact_bytes_unavailable');
      }
      throw storeError('internal_artifact_bytes_unavailable');
    }
    if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
      throw storeError('internal_artifact_bytes_unavailable');
    }
    if (pathStat.size !== expectedSize) {
      throw storeError('internal_artifact_bytes_unavailable');
    }
    return this.safeFs(() => readFile(path), 'internal_artifact_bytes_unavailable');
  }

  private async resolveStorePath(root: string, storageKey: string): Promise<string> {
    ensureRelativeStorageKey(storageKey);
    const candidate = resolve(root, ...storageKey.split('/'));
    await this.assertPathUnderRoot(root, candidate);
    await this.assertNoSymlinkComponents(root, dirname(candidate));
    return candidate;
  }

  private async assertPathUnderRoot(root: string, candidate: string): Promise<void> {
    const rel = relative(root, candidate);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw storeError('internal_artifact_path_escape');
    }
  }

  private async assertNoSymlinkComponents(root: string, path: string): Promise<void> {
    const rel = relative(root, path);
    if (rel === '') {
      await assertNoSymlinkAt(root);
      return;
    }
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw storeError('internal_artifact_path_escape');
    }
    let cursor = root;
    for (const segment of rel.split(sep)) {
      cursor = join(cursor, segment);
      await assertNoSymlinkAt(cursor);
    }
  }

  private safeCanonicalDigest(value: unknown): string {
    try {
      return codexCanonicalDigest(value);
    } catch {
      throw storeError('internal_artifact_request_invalid');
    }
  }

  private async safeFs<T>(operation: () => Promise<T>, reason: string): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw storeError(reason);
    }
  }

  private async sanitizePublicErrors<T>(fallbackReason: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw storeError(fallbackReason);
    }
  }
}

const assertNoSymlinkAt = async (path: string): Promise<void> => {
  try {
    const pathStat = await lstat(path);
    if (pathStat.isSymbolicLink()) {
      throw storeError('internal_artifact_storage_symlink');
    }
  } catch (error) {
    if (isFilesystemError(error, 'ENOENT')) {
      return;
    }
    if (error instanceof DomainError) {
      throw error;
    }
    throw storeError('internal_artifact_storage_unavailable');
  }
};

const isFilesystemError = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { readonly code?: unknown }).code === code;
