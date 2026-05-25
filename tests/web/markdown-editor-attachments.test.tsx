// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { AttachmentRef } from '@forgeloop/contracts';

import { ForgeMarkdownEditor } from '../../apps/web/src/shared/ui/markdown-editor';
import { renderRoute } from './router-test-utils';

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

function EditableEditor(props: Partial<ComponentProps<typeof ForgeMarkdownEditor>>) {
  return (
    <ForgeMarkdownEditor
      allowedBlocks={['paragraph', 'link', 'image']}
      mode="edit"
      objectRef={{ type: 'requirement', id: 'req-1' }}
      onChange={vi.fn()}
      onUploadAttachment={vi.fn()}
      validationPolicy={{ validation_version: '2026-05-23' }}
      value=""
      {...props}
    />
  );
}

async function pasteImage(target: HTMLElement) {
  fireEvent.paste(target, {
    clipboardData: {
      files: [new File(['bytes'], 'paste.png', { type: 'image/png' })],
      items: [],
    },
  });
  await waitFor(() => undefined);
}

async function dropImage(target: HTMLElement, file: File) {
  fireEvent.drop(target, {
    dataTransfer: {
      files: [file],
      items: [],
    },
  });
  await waitFor(() => undefined);
}

async function uploadFile(input: HTMLElement, file: File) {
  await userEvent.upload(input, file);
}

describe('ForgeMarkdownEditor attachments', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('uploads pasted images before inserting attachment references', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onUploadAttachment = vi.fn(async () => publicAttachmentFixture({ id: 'att-paste' }));
    render(<EditableEditor onChange={onChange} onUploadAttachment={onUploadAttachment} />);

    const editor = screen.getByRole('textbox', { name: /markdown editor/i });
    await user.click(editor);
    await pasteImage(editor);

    expect(onUploadAttachment).toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.stringContaining('attachment://att-paste')));
  });

  it('can save immediately after an upload before attachment props refresh', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onUploadAttachment = vi.fn(async () => publicAttachmentFixture({ id: 'att-save' }));
    render(<EditableEditor onSave={onSave} onUploadAttachment={onUploadAttachment} />);

    await pasteImage(screen.getByRole('textbox', { name: /markdown editor/i }));
    await waitFor(() => expect(onUploadAttachment).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      markdown: expect.stringContaining('attachment://att-save'),
      attachment_refs: [expect.objectContaining({ id: 'att-save' })],
    });
  });

  it('does not insert broken markdown when upload fails', async () => {
    const onChange = vi.fn();
    const onUploadAttachment = vi.fn(async () => {
      throw new Error('Upload failed');
    });
    render(<EditableEditor onChange={onChange} onUploadAttachment={onUploadAttachment} />);

    await pasteImage(screen.getByRole('textbox', { name: /markdown editor/i }));
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining('attachment://'));
    expect(await screen.findByText(/upload failed/i)).toBeTruthy();
  });

  it('uploads dropped and toolbar-selected images before inserting attachment references', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onUploadAttachment = vi.fn(async () => publicAttachmentFixture({ id: 'att-toolbar' }));
    render(<EditableEditor onChange={onChange} onUploadAttachment={onUploadAttachment} />);

    await user.click(screen.getByRole('button', { name: /insert image/i }));
    await uploadFile(screen.getByLabelText(/image file/i), new File(['bytes'], 'toolbar.png', { type: 'image/png' }));
    await dropImage(screen.getByRole('textbox', { name: /markdown editor/i }), new File(['bytes'], 'drop.png', { type: 'image/png' }));

    await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledTimes(2));
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('attachment://att-toolbar'));
  });

  it('inserts non-image attachments through the attachment picker as link references', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <EditableEditor
        attachments={[publicAttachmentFixture({ id: 'att-log', filename: 'ci.log', content_type: 'text/plain', evidence_category: 'log' })]}
        onChange={onChange}
        onUploadAttachment={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /attachments/i }));
    await user.click(screen.getByRole('menuitem', { name: /ci.log/i }));

    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('[ci.log](attachment://att-log)'));
  });

  it('keeps image insertion affordances available on source object authoring routes', async () => {
    const user = userEvent.setup();
    const rendered = await renderRoute('/requirements/new');

    await user.click(await rendered.findByRole('button', { name: /insert image/i }));

    expect(rendered.getByLabelText(/image file/i)).toBeTruthy();
    expect(rendered.getByRole('region', { name: /narrative document/i })).toBeTruthy();
    expect(rendered.queryByRole('textbox', { name: /narrative markdown/i })).toBeNull();
  });
});
