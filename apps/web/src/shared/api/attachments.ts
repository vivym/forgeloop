import {
  attachmentDeleteResponseSchema,
  attachmentLinkRequestSchema,
  attachmentPatchSchema,
  attachmentRefSchema,
  attachmentRenderRefSchema,
  attachmentUploadMetadataSchema,
  type AttachmentDeleteResponse,
  type AttachmentPatch,
  type AttachmentRef,
  type AttachmentRenderRef,
  type AttachmentUploadMetadata,
  type ObjectRef,
} from '@forgeloop/contracts';

import { createApiContext, type ForgeloopApiOptions } from './common';

export interface UploadAttachmentInput {
  file: File;
  metadata: AttachmentUploadMetadata;
  actorId?: string;
}

export interface RenderedAttachmentContent {
  blob: Blob;
  contentType: string;
  disposition: string;
}

export function createForgeloopAttachmentApi(options: ForgeloopApiOptions = {}) {
  const { request, rawRequest } = createApiContext(options);

  return {
    uploadAttachment: async ({ file, metadata, actorId }: UploadAttachmentInput): Promise<AttachmentRef> => {
      const form = new FormData();
      form.set('file', file);
      form.set('metadata', JSON.stringify(attachmentUploadMetadataSchema.parse(metadata)));
      return attachmentRefSchema.parse(
        await request<unknown>('/attachments', {
          method: 'POST',
          rawBody: form,
          ...(actorId === undefined ? {} : { actorId }),
        }),
      );
    },
    listAttachments: async (query: { object_type: string; object_id: string }): Promise<AttachmentRef[]> => {
      const params = new URLSearchParams(query);
      return attachmentRefSchema.array().parse(await request<unknown>(`/attachments?${params.toString()}`));
    },
    getAttachment: async (attachmentId: string): Promise<AttachmentRef> =>
      attachmentRefSchema.parse(await request<unknown>(`/attachments/${encodeURIComponent(attachmentId)}`)),
    updateAttachment: async (attachmentId: string, body: AttachmentPatch): Promise<AttachmentRef> =>
      attachmentRefSchema.parse(
        await request<unknown>(`/attachments/${encodeURIComponent(attachmentId)}`, {
          method: 'PATCH',
          body: attachmentPatchSchema.parse(body),
        }),
      ),
    linkAttachment: async (attachmentId: string, objectRef: ObjectRef): Promise<AttachmentRef> =>
      attachmentRefSchema.parse(
        await request<unknown>(`/attachments/${encodeURIComponent(attachmentId)}/links`, {
          method: 'POST',
          body: attachmentLinkRequestSchema.parse({ object_ref: objectRef }),
        }),
      ),
    deleteAttachment: async (attachmentId: string): Promise<AttachmentDeleteResponse> =>
      attachmentDeleteResponseSchema.parse(
        await request<unknown>(`/attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' }),
      ),
    createRenderUrl: async (
      attachmentId: string,
      body: { disposition: 'inline' | 'download' },
    ): Promise<AttachmentRenderRef> =>
      attachmentRenderRefSchema.parse(
        await request<unknown>(`/attachments/${encodeURIComponent(attachmentId)}/render-url`, { method: 'POST', body }),
      ),
    fetchRenderContent: async (renderRef: AttachmentRenderRef): Promise<RenderedAttachmentContent> => {
      const safeRenderRef = attachmentRenderRefSchema.parse(renderRef);
      const response = await rawRequest(safeRenderRef.render_url, { jsonContentType: false });
      return {
        blob: await response.blob(),
        contentType: response.headers.get('content-type') ?? safeRenderRef.content_type,
        disposition: response.headers.get('content-disposition') ?? safeRenderRef.disposition,
      };
    },
  };
}

export type ForgeloopAttachmentApi = ReturnType<typeof createForgeloopAttachmentApi>;
