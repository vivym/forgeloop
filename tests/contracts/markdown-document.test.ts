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

  it('rejects non-canonical attachment destinations', () => {
    for (const markdown of [
      '![bad](attachment://att-1?signature=raw)',
      '![bad](attachment://att-1#frag)',
      '![bad](attachment://att-1/private)',
    ]) {
      expect(validateMarkdownDocument({ ...baseDocument, markdown }).ok).toBe(false);
    }
  });

  it('rejects raw html, javascript links, data urls, blob urls, and raw storage urls', () => {
    for (const markdown of [
      '<iframe src="https://example.com"></iframe>',
      '[bad](javascript:alert(1))',
      '![bad](data:image/png;base64,aaaa)',
      '![bad](blob:https://example.com/1)',
      '![bad](https://bucket.example.com/private/key?signature=raw)',
      '[ref][x]\n\n[x]: javascript:alert(1)',
      '![bad][img]\n\n[img]: data:image/png;base64,aaaa',
      'raw https://bucket.example.com/private/key?signature=raw',
      '<https://bucket.example.com/private/key?signature=raw>',
      '[encoded](java%73cript:alert(1))',
      '[raw](s3://bucket/private.txt)',
      '![raw](gs://bucket/private.png)',
      'raw s3://bucket/private.txt',
    ]) {
      expect(validateMarkdownDocument({ ...baseDocument, markdown }).ok).toBe(false);
    }
  });

  it('returns all validation issues across inline, reference, bare, and attachment scans', () => {
    const result = validateMarkdownDocument({
      ...baseDocument,
      markdown:
        '<iframe></iframe>\n[ref][x]\n\n[x]: javascript:alert(1)\nraw https://bucket.example.com/private/key?signature=raw\n![missing](attachment://att-missing)',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining(['raw_html', 'unsafe_protocol', 'raw_storage_url', 'unresolved_attachment']),
      );
    }
  });

  it('rejects block and inline kinds that are not allowed by policy', () => {
    for (const markdown of [
      '![flow](attachment://att-1)',
      '| Col |\n| --- |\n| Value |',
      '```ts\nconst bad = true;\n```',
      '**bold**',
      '*italic*',
      '~~strike~~',
      '`inline`',
      '---',
    ]) {
      const result = validateMarkdownDocument({
        ...baseDocument,
        allowed_blocks: ['paragraph'],
        markdown,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((issue) => issue.code)).toContain('unsupported_block');
      }
    }
  });

  it('requires task_list policy for task list syntax', () => {
    const result = validateMarkdownDocument({
      ...baseDocument,
      allowed_blocks: ['paragraph', 'list'],
      markdown: '- [ ] task',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain('unsupported_block');
    }
  });

  it('accepts task list syntax when task_list and list are allowed', () => {
    const result = validateMarkdownDocument({
      ...baseDocument,
      allowed_blocks: ['paragraph', 'list', 'task_list'],
      markdown: '- [ ] task',
    });

    expect(result.ok).toBe(true);
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
