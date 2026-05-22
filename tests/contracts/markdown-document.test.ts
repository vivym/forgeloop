import { describe, expect, it } from 'vitest';

import { markdownDocumentSchema, validateMarkdownDocument } from '@forgeloop/contracts';

const baseDocument = {
  object_ref: { type: 'requirement', id: 'req-1', driver_actor_id: 'actor-product' },
  allowed_blocks: ['paragraph', 'heading', 'list', 'link', 'image'],
  attachment_refs: [
    {
      id: 'att-1',
      owner_object_type: 'requirement',
      owner_object_id: 'req-1',
      linked_object_refs: [],
      filename: 'flow.png',
      content_type: 'image/png',
      size_bytes: 42,
      checksum_sha256: 'b'.repeat(64),
      uploaded_by_actor_id: 'actor-product',
      created_at: '2026-05-23T00:00:00.000Z',
      evidence_category: 'image',
      visibility: 'object',
      safety_status: 'passed',
      reference_status: 'active',
    },
  ],
  validation_version: '2026-05-23',
} as const;

describe('MarkdownDocument validation', () => {
  it('accepts attachment references and safe product links', () => {
    const result = validateMarkdownDocument({
      ...baseDocument,
      markdown: 'See [task](/tasks/task-1)\n\n![flow](attachment://att-1)',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects raw html, javascript links, data urls, blob urls, and raw storage urls', () => {
    for (const markdown of [
      '<iframe src="https://example.com"></iframe>',
      '[bad](javascript:alert(1))',
      '![bad](data:image/png;base64,aaaa)',
      '![bad](blob:https://example.com/1)',
      '![bad](https://bucket.example.com/private/key?signature=raw)',
    ]) {
      expect(validateMarkdownDocument({ ...baseDocument, markdown }).ok).toBe(false);
    }
  });

  it('rejects unresolved attachment refs', () => {
    const result = validateMarkdownDocument({
      ...baseDocument,
      markdown: '![missing](attachment://att-missing)',
    });
    expect(result.ok).toBe(false);
  });

  it('exposes a strict persisted document schema', () => {
    expect(() => markdownDocumentSchema.parse({ ...baseDocument, markdown: 'body', raw_html: '<b>bad</b>' })).toThrow();
  });
});
