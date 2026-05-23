import { describe, expect, it, vi } from 'vitest';
import type { AttachmentRef } from '@forgeloop/contracts';

import { createForgeloopAttachmentApi } from '../../apps/web/src/shared/api/attachments';

const publicAttachmentFixture = (overrides: Partial<AttachmentRef> = {}): AttachmentRef => ({
  id: 'att-1',
  owner_object_type: 'requirement',
  owner_object_id: 'req-1',
  linked_object_refs: [],
  filename: 'flow.png',
  content_type: 'image/png',
  size_bytes: 128,
  checksum_sha256: 'a'.repeat(64),
  uploaded_by_actor_id: 'actor-product',
  created_at: '2026-05-23T00:00:00.000Z',
  evidence_category: 'image',
  visibility: 'object',
  safety_status: 'passed',
  reference_status: 'active',
  ...overrides,
});

describe('attachment Web API client', () => {
  it('uploads using multipart FormData without JSON content-type', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(publicAttachmentFixture()), { status: 201 }));
    const api = createForgeloopAttachmentApi({ baseUrl: 'http://api.test', fetch: fetch as typeof globalThis.fetch });

    await api.uploadAttachment({
      file: new File(['bytes'], 'flow.png', { type: 'image/png' }),
      metadata: { object_type: 'requirement', object_id: 'req-1', evidence_category: 'image' },
      actorId: 'actor-product',
    });

    const [, init] = fetch.mock.calls[0] ?? [];
    expect(init?.body).toBeInstanceOf(FormData);
    expect(new Headers(init?.headers).get('content-type')).toBeNull();
  });

  it('rejects render refs that expose raw storage urls', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            attachment_id: 'att-1',
            render_url: 'https://bucket.example.com/raw?signature=x',
            expires_at: '2026-05-23T00:05:00.000Z',
            content_type: 'image/png',
            disposition: 'inline',
          }),
          { status: 200 },
        ),
    );
    const api = createForgeloopAttachmentApi({ baseUrl: 'http://api.test', fetch: fetch as typeof globalThis.fetch });

    await expect(api.createRenderUrl('att-1', { disposition: 'inline' })).rejects.toThrow();
  });

  it('fetches safe render URLs as binary content without leaking raw storage details', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attachment_id: 'att-1',
            render_url: '/api/attachments/att-1/render/render-token',
            expires_at: '2026-05-23T00:05:00.000Z',
            content_type: 'image/png',
            disposition: 'inline',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Blob(['png-bytes'], { type: 'image/png' }), {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-disposition': 'inline; filename="flow.png"' },
        }),
      );
    const api = createForgeloopAttachmentApi({ baseUrl: 'http://api.test', fetch: fetch as typeof globalThis.fetch });

    const renderRef = await api.createRenderUrl('att-1', { disposition: 'inline' });
    const binary = await api.fetchRenderContent(renderRef);

    expect(binary.contentType).toBe('image/png');
    expect(binary.disposition).toBe('inline; filename="flow.png"');
    expect(fetch.mock.calls[1]?.[0]).toBe('http://api.test/api/attachments/att-1/render/render-token');
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('content-type')).toBeNull();
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('storage_uri');
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('bucket.example.com');
  });

  it('supports metadata fetch, patch, link, and archive/delete operations', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(publicAttachmentFixture({ id: 'att-1' })), { status: 200 }));
    const api = createForgeloopAttachmentApi({ baseUrl: 'http://api.test', fetch: fetch as typeof globalThis.fetch });

    await api.getAttachment('att-1');
    await api.updateAttachment('att-1', { caption: 'Checkout failure', visibility: 'project' });
    await api.linkAttachment('att-1', { type: 'task', id: 'task-1' });
    await api.deleteAttachment('att-1');

    expect(fetch.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}`)).toEqual([
      'GET http://api.test/attachments/att-1',
      'PATCH http://api.test/attachments/att-1',
      'POST http://api.test/attachments/att-1/links',
      'DELETE http://api.test/attachments/att-1',
    ]);
  });
});
