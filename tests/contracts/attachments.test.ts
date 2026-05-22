import { describe, expect, it } from 'vitest';

import {
  attachmentRefSchema,
  attachmentRenderRefSchema,
  attachmentUploadMetadataSchema,
} from '@forgeloop/contracts';

describe('attachment contracts', () => {
  it('accepts typed owner objects and public metadata without storage_uri', () => {
    const attachment = attachmentRefSchema.parse({
      id: 'att-1',
      owner_object_type: 'requirement',
      owner_object_id: 'req-1',
      linked_object_refs: [{ type: 'task', id: 'task-1' }],
      filename: 'checkout.png',
      content_type: 'image/png',
      size_bytes: 1200,
      checksum_sha256: 'a'.repeat(64),
      uploaded_by_actor_id: 'actor-product',
      created_at: '2026-05-23T00:00:00.000Z',
      evidence_category: 'image',
      visibility: 'object',
      safety_status: 'passed',
      reference_status: 'active',
    });
    expect('storage_uri' in attachment).toBe(false);
  });

  it('rejects raw storage render urls', () => {
    expect(() =>
      attachmentRenderRefSchema.parse({
        attachment_id: 'att-1',
        render_url: 'https://bucket.example.com/private/key?signature=raw',
        expires_at: '2026-05-23T00:05:00.000Z',
        content_type: 'image/png',
        disposition: 'inline',
      }),
    ).toThrow(/same-origin/i);
  });

  it('parses upload metadata without accepting binary content in JSON', () => {
    expect(
      attachmentUploadMetadataSchema.parse({
        object_type: 'tech_debt',
        object_id: 'td-1',
        evidence_category: 'log',
        visibility: 'object',
      }),
    ).toMatchObject({ object_type: 'tech_debt' });
  });
});
