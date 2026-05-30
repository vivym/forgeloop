import type {
  InternalArtifactKind,
  InternalArtifactObject,
  InternalArtifactOwnerType,
  InternalArtifactVisibility,
} from '@forgeloop/domain';

import type {
  CreateInternalArtifactObjectInput,
  GetInternalArtifactObjectByRefInput,
  TombstoneInternalArtifactObjectInput,
} from '../repositories/delivery-repository';

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

export interface LocalInternalArtifactStoreOptions {
  root: string;
  repository: InternalArtifactMetadataRepository;
  requestId: string;
}

export interface InternalArtifactMetadataRepository {
  createOrReplayInternalArtifactObject(input: CreateInternalArtifactObjectInput): Promise<InternalArtifactObject>;
  getInternalArtifactObjectByRef(input: GetInternalArtifactObjectByRefInput): Promise<InternalArtifactObject | undefined>;
  tombstoneInternalArtifactObject(input: TombstoneInternalArtifactObjectInput): Promise<InternalArtifactObject>;
}
