import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { DomainError } from '@forgeloop/domain';
import { LocalInternalArtifactStore, type DeliveryRepository } from '@forgeloop/db';

import { DELIVERY_REPOSITORY, INTERNAL_ARTIFACT_STORE_ROOT } from '../core/control-plane-tokens';
import { INTERNAL_ARTIFACT_UPLOAD_MAX_BYTES } from './internal-artifacts.constants';
import type { UploadInternalArtifactMetadataDto } from './internal-artifacts.dto';

const deterministicUploadArtifactId = (input: {
  kind: string;
  owner_type: string;
  owner_id: string;
  idempotency_key: string;
  digest: string;
}): string => {
  const hex = createHash('sha256')
    .update(
      JSON.stringify({
        namespace: 'internal-artifact-api-upload-id.v1',
        kind: input.kind,
        owner_type: input.owner_type,
        owner_id: input.owner_id,
        idempotency_key: input.idempotency_key,
        digest: input.digest,
      }),
    )
    .digest('hex');
  return hex;
};

const isArtifactNotFound = (error: unknown): boolean =>
  error instanceof DomainError &&
  (error.message === 'internal_artifact_not_found' || error.message === 'internal_artifact_bytes_unavailable');

const artifactConflictReasons = new Set([
  'internal_artifact_ref_conflict',
  'internal_artifact_owner_kind_artifact_conflict',
  'internal_artifact_idempotency_drift',
]);

const artifactValidationReasons = new Set([
  'internal_artifact_invalid_size_bytes',
  'internal_artifact_invalid_digest',
  'internal_artifact_size_mismatch',
  'internal_artifact_digest_mismatch',
  'internal_artifact_invalid_max_size_bytes',
  'internal_artifact_request_invalid',
  'internal_artifact_ref_mismatch',
]);

const artifactStorageReasons = new Set([
  'internal_artifact_storage_unavailable',
  'internal_artifact_bytes_unavailable',
  'internal_artifact_storage_symlink',
  'internal_artifact_path_escape',
  'internal_artifact_storage_key_invalid',
]);

const mapArtifactStoreError = (error: unknown): never => {
  if (!(error instanceof DomainError)) {
    throw error;
  }
  if (isArtifactNotFound(error)) {
    throw new NotFoundException('Internal artifact not found');
  }
  if (error.message === 'internal_artifact_max_size_exceeded') {
    throw new PayloadTooLargeException('Internal artifact upload was rejected');
  }
  if (artifactConflictReasons.has(error.message)) {
    throw new ConflictException('Internal artifact request conflicts with existing artifact state');
  }
  if (artifactValidationReasons.has(error.message)) {
    throw new BadRequestException('Internal artifact request was rejected');
  }
  if (artifactStorageReasons.has(error.message)) {
    throw new ServiceUnavailableException('Internal artifact storage is unavailable');
  }
  throw new BadRequestException('Internal artifact request was rejected');
};

@Injectable()
export class InternalArtifactsService {
  private readonly store: LocalInternalArtifactStore;

  constructor(
    @Inject(DELIVERY_REPOSITORY) repository: DeliveryRepository,
    @Inject(INTERNAL_ARTIFACT_STORE_ROOT) root: string,
  ) {
    this.store = new LocalInternalArtifactStore({
      root,
      repository,
      requestId: 'control-plane-api',
    });
  }

  async uploadObject(input: {
    metadata: UploadInternalArtifactMetadataDto;
    bytes: Uint8Array;
    actorId: string;
  }) {
    const artifactId = deterministicUploadArtifactId({
      kind: input.metadata.kind,
      owner_type: input.metadata.owner_type,
      owner_id: input.metadata.owner_id,
      idempotency_key: input.metadata.idempotency_key,
      digest: input.metadata.declared_artifact_digest,
    });

    return this.mapStoreError(() =>
      this.store.putObject({
        artifact_id: artifactId,
        kind: input.metadata.kind,
        owner_type: input.metadata.owner_type,
        owner_id: input.metadata.owner_id,
        visibility: input.metadata.visibility,
        content_type: input.metadata.content_type,
        declared_size_bytes: input.metadata.declared_size_bytes,
        declared_artifact_digest: input.metadata.declared_artifact_digest,
        idempotency_key: input.metadata.idempotency_key,
        metadata_json: input.metadata.metadata_json,
        created_by_actor_type: input.metadata.created_by_actor_type ?? 'system',
        created_by_actor_id: input.metadata.created_by_actor_id ?? input.actorId,
        now: new Date().toISOString(),
        max_size_bytes: input.metadata.max_size_bytes ?? INTERNAL_ARTIFACT_UPLOAD_MAX_BYTES,
        bytes: input.bytes,
      }),
    );
  }

  async statObject(ref: string) {
    return this.mapStoreError(() => this.store.statObject(ref));
  }

  async getObject(ref: string) {
    return this.mapStoreError(() => this.store.getObject(ref));
  }

  async deleteObject(ref: string) {
    return this.mapStoreError(() => this.store.deleteObject(ref));
  }

  private async mapStoreError<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      mapArtifactStoreError(error);
      throw error;
    }
  }
}
