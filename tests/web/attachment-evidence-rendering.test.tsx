// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentRef, AttachmentRenderRef } from '@forgeloop/contracts';

import { EvidenceAttachments } from '../../apps/web/src/shared/ui/evidence-attachments';

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

const renderRefFixture = (overrides: Partial<AttachmentRenderRef> = {}): AttachmentRenderRef => ({
  attachment_id: 'att-1',
  render_url: '/api/attachments/att-1/render/render-token',
  expires_at: '2026-05-23T00:05:00.000Z',
  content_type: 'image/png',
  disposition: 'inline',
  ...overrides,
});

describe('EvidenceAttachments', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('resolves safe render URLs and renders images inline with alt text', async () => {
    const createRenderUrl = vi.fn(async () => renderRefFixture());

    render(<EvidenceAttachments attachments={[publicAttachmentFixture({ alt_text: 'Checkout flow' })]} createRenderUrl={createRenderUrl} />);

    expect((await screen.findByRole('img', { name: 'Checkout flow' })).getAttribute('src')).toBe(
      '/api/attachments/att-1/render/render-token',
    );
    expect(createRenderUrl).toHaveBeenCalledWith('att-1', { disposition: 'inline' });
  });

  it('renders documents and logs as open or download actions through safe render refs', async () => {
    const createRenderUrl = vi.fn(async () =>
      renderRefFixture({
        attachment_id: 'att-log',
        render_url: '/api/attachments/att-log/render/render-token',
        content_type: 'text/plain',
        disposition: 'download',
      }),
    );

    render(
      <EvidenceAttachments
        attachments={[
          publicAttachmentFixture({ id: 'att-log', filename: 'ci.log', content_type: 'text/plain', evidence_category: 'log' }),
        ]}
        createRenderUrl={createRenderUrl}
      />,
    );

    expect((await screen.findByRole('link', { name: /open ci.log/i })).getAttribute('href')).toBe(
      '/api/attachments/att-log/render/render-token',
    );
    expect(screen.getByRole('link', { name: /download ci.log/i }).getAttribute('href')).toBe(
      '/api/attachments/att-log/render/render-token',
    );
  });

  it('renders archived, tombstoned, unavailable, and unsafe refs as unavailable evidence without raw URI leakage', async () => {
    const createRenderUrl = vi.fn(async () =>
      renderRefFixture({
        render_url: 'https://bucket.example.com/raw?signature=x',
      } as Partial<AttachmentRenderRef>),
    );

    render(
      <EvidenceAttachments
        attachments={[
          publicAttachmentFixture({ id: 'att-archived', reference_status: 'archived', filename: 'archived.png' }),
          publicAttachmentFixture({ id: 'att-tombstoned', reference_status: 'tombstoned', filename: 'tombstoned.png' }),
          publicAttachmentFixture({ id: 'att-unavailable', safety_status: 'unavailable', filename: 'unavailable.png' }),
          publicAttachmentFixture({ id: 'att-unsafe', filename: 'unsafe.png' }),
        ]}
        createRenderUrl={createRenderUrl}
      />,
    );

    await waitFor(() => expect(screen.getAllByText(/unavailable evidence/i).length).toBeGreaterThanOrEqual(4));
    expect(document.body.textContent).not.toContain('bucket.example.com');
    expect(document.body.innerHTML).not.toContain('https://bucket.example.com');
  });

  it('does not render a safe render URL when it belongs to a different attachment', async () => {
    const createRenderUrl = vi.fn(async () =>
      renderRefFixture({
        attachment_id: 'att-other',
        render_url: '/api/attachments/att-other/render/render-token',
      }),
    );

    render(<EvidenceAttachments attachments={[publicAttachmentFixture({ alt_text: 'Checkout flow' })]} createRenderUrl={createRenderUrl} />);

    await waitFor(() => expect(screen.getByText(/unavailable evidence/i)).toBeTruthy());
    expect(screen.queryByRole('img', { name: 'Checkout flow' })).toBeNull();
    expect(document.body.innerHTML).not.toContain('/api/attachments/att-other/render/render-token');
  });
});
