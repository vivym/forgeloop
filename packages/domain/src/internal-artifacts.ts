import { DomainError, type IsoDateTime } from './types.js';

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
  created_at: IsoDateTime;
  deleted_at?: IsoDateTime;
}

export interface InternalArtifactRefParts {
  kind: InternalArtifactKind;
  owner_type: InternalArtifactOwnerType;
  owner_id: string;
  artifact_id: string;
}

export interface RuntimeArtifactUploadProofMetadata {
  schema_version: 'codex_runtime_job_artifact_upload.v2';
  worker_session_token: string;
  nonce: string;
  nonce_timestamp: IsoDateTime;
  artifact_idempotency_key: string;
  kind: string;
  name: string;
  content_type: string;
  digest: string;
  size_bytes: string;
  metadata_json?: Record<string, unknown>;
}

export interface RuntimeArtifactUploadProofInput {
  method: string;
  path: string;
  worker_id: string;
  runtime_job_id: string;
  metadata: RuntimeArtifactUploadProofMetadata;
}

export interface RuntimeArtifactUploadProofPayload {
  schema_version: 'runtime_artifact_upload_proof.v1';
  method: string;
  path: string;
  worker_id: string;
  runtime_job_id: string;
  worker_session_token: string;
  nonce: string;
  nonce_timestamp: IsoDateTime;
  upload: Omit<RuntimeArtifactUploadProofMetadata, 'worker_session_token' | 'nonce' | 'nonce_timestamp'>;
}

const internalArtifactKindSet = new Set<string>(internalArtifactKinds);
const internalArtifactOwnerTypeSet = new Set<string>(internalArtifactOwnerTypes);
const internalArtifactRefPrefix = 'artifact://internal/';
const internalArtifactRefSegmentPattern = /^[a-z0-9_-]+$/;
const strictUnpaddedBase64UrlPattern = /^[A-Za-z0-9_-]+$/;

const invalidInternalArtifactRef = (message: string, details?: Record<string, unknown>): DomainError =>
  new DomainError('codex_docker_runtime_evidence_unsafe', message, details);

const assertInternalArtifactRefSegment = (value: string, label: string): void => {
  if (
    value.length === 0 ||
    value === '.' ||
    value === '..' ||
    value.includes('\\') ||
    value.includes('%') ||
    !internalArtifactRefSegmentPattern.test(value)
  ) {
    throw invalidInternalArtifactRef(`Internal artifact ref ${label} segment is invalid.`);
  }
};

export const buildInternalArtifactRef = (parts: InternalArtifactRefParts): string => {
  if (!internalArtifactKindSet.has(parts.kind)) {
    throw invalidInternalArtifactRef('Internal artifact ref kind is invalid.');
  }
  if (!internalArtifactOwnerTypeSet.has(parts.owner_type)) {
    throw invalidInternalArtifactRef('Internal artifact ref owner_type is invalid.');
  }
  assertInternalArtifactRefSegment(parts.owner_id, 'owner_id');
  assertInternalArtifactRefSegment(parts.artifact_id, 'artifact_id');
  return `${internalArtifactRefPrefix}${parts.kind}/${parts.owner_type}/${parts.owner_id}/${parts.artifact_id}`;
};

export const parseInternalArtifactRef = (ref: string): InternalArtifactRefParts => {
  if (
    typeof ref !== 'string' ||
    !ref.startsWith(internalArtifactRefPrefix) ||
    ref.includes('?') ||
    ref.includes('#') ||
    ref.includes('\\')
  ) {
    throw invalidInternalArtifactRef('Internal artifact ref must use the canonical artifact://internal namespace.');
  }
  const segments = ref.slice(internalArtifactRefPrefix.length).split('/');
  if (segments.length !== 4) {
    throw invalidInternalArtifactRef('Internal artifact ref must contain kind, owner_type, owner_id, and artifact_id.');
  }
  const [kind, ownerType, ownerId, artifactId] = segments as [string, string, string, string];
  for (const [label, segment] of [
    ['kind', kind],
    ['owner_type', ownerType],
    ['owner_id', ownerId],
    ['artifact_id', artifactId],
  ] as const) {
    assertInternalArtifactRefSegment(segment, label);
  }
  if (!internalArtifactKindSet.has(kind)) {
    throw invalidInternalArtifactRef('Internal artifact ref kind is invalid.');
  }
  if (!internalArtifactOwnerTypeSet.has(ownerType)) {
    throw invalidInternalArtifactRef('Internal artifact ref owner_type is invalid.');
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

export const encodeInternalArtifactRefBase64Url = (ref: string): string => {
  parseInternalArtifactRef(ref);
  return Buffer.from(ref, 'utf8').toString('base64url');
};

export const decodeInternalArtifactRefBase64Url = (encoded: string): string => {
  if (typeof encoded !== 'string' || encoded.length === 0 || !strictUnpaddedBase64UrlPattern.test(encoded)) {
    throw invalidInternalArtifactRef('Internal artifact ref transport encoding must be strict unpadded base64url.');
  }
  const ref = Buffer.from(encoded, 'base64url').toString('utf8');
  parseInternalArtifactRef(ref);
  if (encodeInternalArtifactRefBase64Url(ref) !== encoded) {
    throw invalidInternalArtifactRef('Internal artifact ref transport encoding is not canonical.');
  }
  return ref;
};

export const runtimeArtifactUploadProofPayload = (
  input: RuntimeArtifactUploadProofInput,
): RuntimeArtifactUploadProofPayload => {
  const { worker_session_token, nonce, nonce_timestamp, ...upload } = input.metadata;
  return {
    schema_version: 'runtime_artifact_upload_proof.v1',
    method: input.method,
    path: input.path,
    worker_id: input.worker_id,
    runtime_job_id: input.runtime_job_id,
    worker_session_token,
    nonce,
    nonce_timestamp,
    upload,
  };
};
