import { BadRequestException } from '@nestjs/common';
import {
  decodeInternalArtifactRefBase64Url,
  internalArtifactKinds,
  internalArtifactOwnerTypes,
  type InternalArtifactObject,
} from '@forgeloop/domain';
import { z } from 'zod';

const decimalSizeSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const safeRefSegmentSchema = z.string().regex(/^[a-z0-9_-]+$/);
const metadataJsonSchema = z.record(z.string(), z.unknown());
const requesterTypeSchema = z.enum(['codex_worker', 'system', 'admin']);
type HeaderMap = Record<string, string | string[] | undefined>;
type QueryMap = Record<string, unknown>;

const invalidMetadataMessage = 'Internal artifact metadata validation failed';
const invalidQueryMessage = 'Internal artifact query validation failed';
const invalidHeadersMessage = 'Internal artifact request headers validation failed';
const invalidBodyMessage = 'Internal artifact request validation failed';

const utcIsoTimestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

const rejectInvalid = (message: string): never => {
  throw new BadRequestException(message);
};

export const uploadInternalArtifactMetadataSchema = z
  .object({
    schema_version: z.literal('internal_artifact_upload.v1'),
    owner_type: z.enum(internalArtifactOwnerTypes),
    owner_id: safeRefSegmentSchema,
    kind: z.enum(internalArtifactKinds),
    visibility: z.enum(['internal', 'private']),
    content_type: z.string().min(1),
    declared_size_bytes: decimalSizeSchema,
    declared_artifact_digest: sha256DigestSchema,
    idempotency_key: z.string().min(1),
    metadata_json: metadataJsonSchema,
    created_by_actor_type: z.enum(['codex_worker', 'system', 'user']).optional(),
    created_by_actor_id: z.string().min(1).optional(),
    max_size_bytes: z.number().int().nonnegative().optional(),
  })
  .strict();

export const internalArtifactRefRequestSchema = z
  .object({
    schema_version: z.literal('internal_artifact_ref_request.v1'),
    ref_base64url: z.string().min(1),
    requester_type: requesterTypeSchema,
    requester_id: z.string().min(1),
    nonce: z.string().min(1).optional(),
    nonce_timestamp: utcIsoTimestampSchema.optional(),
    body_digest: sha256DigestSchema.optional(),
  })
  .strict();

export const internalArtifactQuerySchema = z
  .object({
    ref_base64url: z.string().min(1),
  })
  .strict();

export const internalArtifactRefHeaderSchema = z
  .object({
    requester_type: requesterTypeSchema.optional(),
    requester_id: z.string().min(1).optional(),
    nonce: z.string().min(1).optional(),
    nonce_timestamp: utcIsoTimestampSchema.optional(),
    body_digest: sha256DigestSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.requester_type === undefined) !== (value.requester_id === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'requester_type and requester_id headers must be supplied together',
        path: value.requester_type === undefined ? ['requester_type'] : ['requester_id'],
      });
    }
  });

export type UploadInternalArtifactMetadataDto = z.infer<typeof uploadInternalArtifactMetadataSchema>;
export type InternalArtifactRefRequestDto = z.infer<typeof internalArtifactRefRequestSchema>;
export type InternalArtifactQueryDto = z.infer<typeof internalArtifactQuerySchema>;
export type InternalArtifactRefHeaderDto = z.infer<typeof internalArtifactRefHeaderSchema>;
export type InternalArtifactResponseDto = Pick<
  InternalArtifactObject,
  | 'ref'
  | 'kind'
  | 'content_type'
  | 'size_bytes'
  | 'digest'
  | 'visibility'
  | 'owner_type'
  | 'owner_id'
  | 'created_at'
  | 'deleted_at'
>;

export const internalArtifactResponse = (artifact: InternalArtifactObject): InternalArtifactResponseDto => {
  return {
    ref: artifact.ref,
    kind: artifact.kind,
    content_type: artifact.content_type,
    size_bytes: artifact.size_bytes,
    digest: artifact.digest,
    visibility: artifact.visibility,
    owner_type: artifact.owner_type,
    owner_id: artifact.owner_id,
    created_at: artifact.created_at,
    ...(artifact.deleted_at === undefined ? {} : { deleted_at: artifact.deleted_at }),
  };
};

export const parseInternalArtifactMetadataHeader = (value: string | undefined): UploadInternalArtifactMetadataDto => {
  if (value === undefined || value.trim().length === 0) {
    throw new BadRequestException('Internal artifact metadata header is required');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('Internal artifact metadata header must be base64url JSON');
  }

  const parsed = uploadInternalArtifactMetadataSchema.safeParse(decoded);
  if (!parsed.success) {
    rejectInvalid(invalidMetadataMessage);
  }
  if (parsed.data === undefined) {
    rejectInvalid(invalidMetadataMessage);
  }
  return parsed.data as UploadInternalArtifactMetadataDto;
};

export const parseInternalArtifactQuery = (query: QueryMap): InternalArtifactQueryDto => {
  const parsed = internalArtifactQuerySchema.safeParse(query);
  if (!parsed.success) {
    rejectInvalid(invalidQueryMessage);
  }
  if (parsed.data === undefined) {
    rejectInvalid(invalidQueryMessage);
  }
  return parsed.data as InternalArtifactQueryDto;
};

export const parseInternalArtifactRefQuery = (query: InternalArtifactQueryDto): string => {
  try {
    return decodeInternalArtifactRefBase64Url(query.ref_base64url);
  } catch {
    throw new BadRequestException('Internal artifact ref query is invalid');
  }
};

const singleHeaderValue = (headers: HeaderMap, name: string): string | undefined => {
  const values = Object.entries(headers)
    .filter(([headerName, value]) => headerName.toLowerCase() === name && value !== undefined)
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]));

  if (values.length > 1) {
    rejectInvalid(invalidHeadersMessage);
  }

  return values[0]?.trim();
};

const containsArtifactHeader = (name: string): boolean => name.toLowerCase().startsWith('x-forgeloop-artifact-');

export const parseInternalArtifactRefHeaders = (headers: HeaderMap): InternalArtifactRefHeaderDto => {
  const allowedHeaders = new Set([
    'x-forgeloop-artifact-requester-type',
    'x-forgeloop-artifact-requester-id',
    'x-forgeloop-artifact-nonce',
    'x-forgeloop-artifact-nonce-timestamp',
    'x-forgeloop-artifact-body-digest',
  ]);
  if (Object.keys(headers).some((name) => containsArtifactHeader(name) && !allowedHeaders.has(name.toLowerCase()))) {
    rejectInvalid(invalidHeadersMessage);
  }

  const parsed = internalArtifactRefHeaderSchema.safeParse({
    requester_type: singleHeaderValue(headers, 'x-forgeloop-artifact-requester-type'),
    requester_id: singleHeaderValue(headers, 'x-forgeloop-artifact-requester-id'),
    nonce: singleHeaderValue(headers, 'x-forgeloop-artifact-nonce'),
    nonce_timestamp: singleHeaderValue(headers, 'x-forgeloop-artifact-nonce-timestamp'),
    body_digest: singleHeaderValue(headers, 'x-forgeloop-artifact-body-digest'),
  });

  if (!parsed.success) {
    rejectInvalid(invalidHeadersMessage);
  }
  if (parsed.data === undefined) {
    rejectInvalid(invalidHeadersMessage);
  }

  return parsed.data as InternalArtifactRefHeaderDto;
};

export const parseInternalArtifactRefRequestBody = (body: unknown): InternalArtifactRefRequestDto => {
  const parsed = internalArtifactRefRequestSchema.safeParse(body);
  if (!parsed.success) {
    rejectInvalid(invalidBodyMessage);
  }
  if (parsed.data === undefined) {
    rejectInvalid(invalidBodyMessage);
  }
  return parsed.data as InternalArtifactRefRequestDto;
};

export const parseInternalArtifactRefBody = (body: InternalArtifactRefRequestDto): string => {
  try {
    return decodeInternalArtifactRefBase64Url(body.ref_base64url);
  } catch {
    throw new BadRequestException('Internal artifact ref request is invalid');
  }
};
