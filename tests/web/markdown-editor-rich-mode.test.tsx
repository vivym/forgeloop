// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentRef } from '@forgeloop/contracts';

import { ForgeMarkdownEditor } from '../../apps/web/src/shared/ui/markdown-editor';

const publicAttachmentFixture = (overrides: Partial<AttachmentRef> = {}): AttachmentRef => ({
  id: 'att-rich',
  owner_object_type: 'task',
  owner_object_id: 'task-1',
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

describe('ForgeMarkdownEditor rich editor events', () => {
  afterEach(() => {
    cleanup();
    delete (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not double-handle rich editor paste and drop events already handled by MDXEditor', () => {
    vi.stubGlobal('ClipboardEvent', class TestClipboardEvent extends Event {});
    vi.stubGlobal('DragEvent', class TestDragEvent extends Event {});
    Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: () => null });
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Chrome');
    const onUploadAttachment = vi.fn(async () => publicAttachmentFixture());
    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph', 'image']}
        mode="edit"
        objectRef={{ type: 'task', id: 'task-1' }}
        onChange={vi.fn()}
        onUploadAttachment={onUploadAttachment}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value=""
      />,
    );

    const editor = screen.getByRole('textbox', { name: /editable markdown/i });
    const image = new File(['bytes'], 'paste.png', { type: 'image/png' });
    fireEvent.paste(editor, { clipboardData: { files: [image], items: [], types: ['Files'] } });
    fireEvent.drop(editor, { dataTransfer: { files: [image], items: [], types: ['Files'] } });

    expect(onUploadAttachment).not.toHaveBeenCalled();
  });
});
