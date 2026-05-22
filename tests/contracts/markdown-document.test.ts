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

  it('accepts https external links and same-origin product links', () => {
    for (const markdown of [
      '[external](https://example.com/docs)',
      '[storage guide](https://example.com/storage-guide)',
      '[bucket list](https://example.com/bucket-list)',
      '[task](/tasks/task-1)',
      '[new requirement](/requirements/new)',
      '[new task](/tasks/new)',
      '[requirement evidence](/requirements/req-1/evidence)',
      '[task package](/tasks/task-1/packages/pkg-1)',
      '[release readiness](/reports/release-readiness)',
      '[external][docs]\n\n[docs]: https://example.com/docs',
    ]) {
      expect(validateMarkdownDocument({ ...baseDocument, markdown }).ok).toBe(true);
    }
  });

  it('rejects image destinations that are not canonical attachment refs', () => {
    for (const markdown of [
      '![remote](https://example.com/image.png)',
      '![relative](/api/attachments/att-1/render/token)',
      '![ref][img]\n\n[img]: https://example.com/image.png',
    ]) {
      expect(validateMarkdownDocument({ ...baseDocument, markdown }).ok).toBe(false);
    }
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

  it('rejects link destinations outside the allowlist', () => {
    for (const markdown of [
      '[http](http://example.com)',
      '[ftp](ftp://example.com/file)',
      '[attachment](attachment:/att-1)',
      '[mail](mailto:test@example.com)',
      '[api](/api/attachments/att-1/render/token)',
      '[http][ref]\n\n[ref]: http://example.com',
      '[api][ref]\n\n[ref]: /api/attachments/att-1/render/token',
      '[api](/api/secrets)',
      '[asset](/assets/app.js)',
      '[dev tools](/dev-tools)',
      '[bad requirement new evidence](/requirements/new/evidence)',
      '[bad task new package](/tasks/new/packages/pkg-1)',
      '[bad spec new](/specs/new)',
      '[query](/tasks/task-1?token=secret)',
      '[hash](/tasks/task-1#frag)',
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
      'Bad ftp://example.com/file',
      'Bad javascript:alert(1)',
      'Bad data:text/html;base64,aaaa',
      'Bad blob:https://example.com/1',
      'Bad attachment:/att-1',
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
      'https://example.com',
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

  it('rejects heading levels above h4', () => {
    for (const markdown of ['##### h5', '###### h6']) {
      const result = validateMarkdownDocument({
        ...baseDocument,
        allowed_blocks: ['paragraph', 'heading'],
        markdown,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((issue) => issue.code)).toContain('unsupported_block');
      }
    }
  });

  it('accepts h4 when heading is allowed', () => {
    expect(
      validateMarkdownDocument({
        ...baseDocument,
        allowed_blocks: ['paragraph', 'heading'],
        markdown: '#### h4',
      }).ok,
    ).toBe(true);
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

  it('validates bare canonical attachment refs', () => {
    const result = validateMarkdownDocument({
      ...baseDocument,
      markdown: 'Use attachment://att-1 for the flow.',
    });

    expect(result).toMatchObject({ ok: true, attachment_ids: ['att-1'] });
  });

  it('rejects unresolved bare attachment refs', () => {
    const result = validateMarkdownDocument({
      ...baseDocument,
      markdown: 'Missing attachment://att-missing.',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain('unresolved_attachment');
    }
  });

  it('rejects non-canonical bare attachment refs', () => {
    for (const markdown of [
      'Bad attachment://att-1?signature=raw',
      'Bad attachment://att-1#frag',
      'Bad attachment://att-1/private',
    ]) {
      expect(validateMarkdownDocument({ ...baseDocument, markdown }).ok).toBe(false);
    }
  });

  it('rejects active attachments that are not owned by or linked to the document object', () => {
    const result = validateMarkdownDocument({
      ...baseDocument,
      markdown: '![other](attachment://att-other)',
      attachment_refs: [
        {
          ...baseDocument.attachment_refs[0],
          id: 'att-other',
          owner_object_type: 'task',
          owner_object_id: 'task-other',
          linked_object_refs: [],
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it('accepts active attachments linked to the document object', () => {
    const result = validateMarkdownDocument({
      ...baseDocument,
      markdown: '![other](attachment://att-other)',
      attachment_refs: [
        {
          ...baseDocument.attachment_refs[0],
          id: 'att-other',
          owner_object_type: 'task',
          owner_object_id: 'task-other',
          linked_object_refs: [{ type: 'requirement', id: 'req-1' }],
        },
      ],
    });

    expect(result.ok).toBe(true);
  });

  it('rejects archived, tombstoned, or blocked attachments', () => {
    for (const attachmentOverride of [
      { reference_status: 'archived' },
      { reference_status: 'tombstoned' },
      { safety_status: 'blocked' },
      { safety_status: 'unavailable' },
    ] as const) {
      const result = validateMarkdownDocument({
        ...baseDocument,
        markdown: '![flow](attachment://att-1)',
        attachment_refs: [
          {
            ...baseDocument.attachment_refs[0],
            ...attachmentOverride,
          },
        ],
      });

      expect(result.ok).toBe(false);
    }
  });

  it('exposes a strict persisted document schema', () => {
    expect(() => markdownDocumentSchema.parse({ ...baseDocument, markdown: 'body', raw_html: '<b>bad</b>' })).toThrow();
  });
});
