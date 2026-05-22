import { z } from 'zod';

import { objectRefSchema } from './product-object-ref.js';

const nonEmpty = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime();

export const attachmentOwnerObjectTypeSchema = z.enum([
  'initiative',
  'requirement',
  'tech_debt',
  'spec',
  'plan',
  'task',
  'bug',
  'release',
]);
export type AttachmentOwnerObjectType = z.infer<typeof attachmentOwnerObjectTypeSchema>;

export const attachmentEvidenceCategorySchema = z.enum([
  'image',
  'log',
  'recording',
  'document',
  'generated_artifact',
]);
export type AttachmentEvidenceCategory = z.infer<typeof attachmentEvidenceCategorySchema>;

export const attachmentVisibilitySchema = z.enum(['object', 'release', 'project']);
export type AttachmentVisibility = z.infer<typeof attachmentVisibilitySchema>;

export const attachmentSafetyStatusSchema = z.enum(['pending', 'passed', 'blocked', 'unavailable']);
export type AttachmentSafetyStatus = z.infer<typeof attachmentSafetyStatusSchema>;

export const attachmentReferenceStatusSchema = z.enum(['active', 'archived', 'tombstoned']);
export type AttachmentReferenceStatus = z.infer<typeof attachmentReferenceStatusSchema>;

export const attachmentUploadMetadataSchema = z
  .object({
    object_type: attachmentOwnerObjectTypeSchema,
    object_id: nonEmpty,
    evidence_category: attachmentEvidenceCategorySchema,
    caption: nonEmpty.optional(),
    alt_text: nonEmpty.optional(),
    visibility: attachmentVisibilitySchema.default('object'),
  })
  .strict();
export type AttachmentUploadMetadata = z.infer<typeof attachmentUploadMetadataSchema>;

export const attachmentRefSchema = z
  .object({
    id: nonEmpty,
    owner_object_type: attachmentOwnerObjectTypeSchema,
    owner_object_id: nonEmpty,
    linked_object_refs: z.array(objectRefSchema).default([]),
    filename: nonEmpty,
    content_type: nonEmpty,
    size_bytes: z.number().int().nonnegative(),
    checksum_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
    uploaded_by_actor_id: nonEmpty,
    created_at: isoDateTimeSchema,
    evidence_category: attachmentEvidenceCategorySchema,
    caption: nonEmpty.optional(),
    alt_text: nonEmpty.optional(),
    visibility: attachmentVisibilitySchema,
    safety_status: attachmentSafetyStatusSchema,
    reference_status: attachmentReferenceStatusSchema,
  })
  .strict();
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;

const sameOriginRenderUrlSchema = z.string().trim().min(1).superRefine((value, ctx) => {
  const parsedUrl = parseRelativeRenderUrl(value);

  if (parsedUrl === undefined) {
    ctx.addIssue({ code: 'custom', message: 'render_url must be a same-origin attachment API URL' });
    return;
  }

  if (!/^\/api\/attachments\/[^/]+\/render\/[^/]+$/.test(parsedUrl.pathname)) {
    ctx.addIssue({ code: 'custom', message: 'render_url must be an attachment render API path' });
  }
  if (parsedUrl.search.length > 0 || parsedUrl.hash.length > 0) {
    ctx.addIssue({ code: 'custom', message: 'render_url must not include query string or fragment' });
  }
  if (/storage|bucket|s3|signature|x-amz|https?:\/\//i.test(value)) {
    ctx.addIssue({ code: 'custom', message: 'render_url must not expose raw storage details' });
  }
});

function parseRelativeRenderUrl(value: string): { pathname: string; search: string; hash: string } | undefined {
  if (!value.startsWith('/') || value.startsWith('//')) {
    return undefined;
  }

  const hashIndex = value.indexOf('#');
  const searchIndex = value.indexOf('?');
  const pathEndCandidates = [searchIndex, hashIndex].filter((index) => index >= 0);
  const pathEnd = pathEndCandidates.length === 0 ? value.length : Math.min(...pathEndCandidates);

  return {
    pathname: value.slice(0, pathEnd),
    search: searchIndex >= 0 ? value.slice(searchIndex, hashIndex >= 0 ? hashIndex : value.length) : '',
    hash: hashIndex >= 0 ? value.slice(hashIndex) : '',
  };
}

export const attachmentRenderRefSchema = z
  .object({
    attachment_id: nonEmpty,
    render_url: sameOriginRenderUrlSchema,
    expires_at: isoDateTimeSchema,
    content_type: nonEmpty,
    disposition: z.enum(['inline', 'download']),
  })
  .strict();
export type AttachmentRenderRef = z.infer<typeof attachmentRenderRefSchema>;

export const attachmentLinkRequestSchema = z
  .object({
    object_ref: objectRefSchema,
  })
  .strict();
export type AttachmentLinkRequest = z.infer<typeof attachmentLinkRequestSchema>;

export const attachmentPatchSchema = z
  .object({
    caption: nonEmpty.optional(),
    alt_text: nonEmpty.optional(),
    evidence_category: attachmentEvidenceCategorySchema.optional(),
    visibility: attachmentVisibilitySchema.optional(),
  })
  .strict();
export type AttachmentPatch = z.infer<typeof attachmentPatchSchema>;

export const attachmentDeleteResponseSchema = z.union([
  attachmentRefSchema,
  z.object({ deleted: z.literal(true) }).strict(),
]);
export type AttachmentDeleteResponse = z.infer<typeof attachmentDeleteResponseSchema>;
