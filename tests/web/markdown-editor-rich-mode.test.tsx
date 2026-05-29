// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentRef } from '@forgeloop/contracts';

import { ForgeMarkdownEditor } from '../../apps/web/src/shared/ui/markdown-editor';
import { renderRoute } from './router-test-utils';

const publicAttachmentFixture = (overrides: Partial<AttachmentRef> = {}): AttachmentRef => ({
  id: 'att-rich',
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
        objectRef={{ type: 'requirement', id: 'req-1' }}
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

  it('routes planning input authoring through the shared ForgeMarkdownEditor wrapper', async () => {
    const rendered = await renderRoute('/requirements/new');

    expect(await rendered.findByRole('heading', { name: 'New Requirement' })).toBeTruthy();
    expect(rendered.getByRole('region', { name: /narrative document/i })).toBeTruthy();
    expect(rendered.getByRole('button', { name: /source mode/i })).toBeTruthy();
    expect(rendered.getByRole('button', { name: /revisions/i })).toBeTruthy();
    expect(rendered.queryByRole('textbox', { name: /narrative markdown/i })).toBeNull();
  });

  it('guards navigation away from dirty Spec and Implementation Plan Doc documents without submitting or approving', async () => {
    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph', 'heading', 'link', 'image', 'table', 'code_block', 'inline_code']}
        guardRouteTransitions
        mode="edit"
        objectRef={{
          type: 'implementation_plan_revision',
          id: 'planrev-requirements-database-view-v1',
          implementation_plan_id: 'plan-requirements-database-view',
        }}
        onChange={vi.fn()}
        onUploadAttachment={vi.fn()}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="Draft"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /source mode/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /markdown source/i }), '\nUnsaved acceptance notes');

    expect(screen.getByLabelText(/editor toolbar/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^approve/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^submit/i })).toBeNull();
  });
});
