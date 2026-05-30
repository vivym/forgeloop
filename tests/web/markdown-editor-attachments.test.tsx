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

  it('persists pasted image refs with alt text and caption metadata', async () => {
    const onChange = vi.fn();
    const onUploadAttachment = vi.fn(async (file: File, objectRef) =>
      publicAttachmentFixture({
        id: 'att-plan-flow',
        owner_object_type: objectRef.type,
        owner_object_id: objectRef.id,
        filename: file.name,
        content_type: file.type,
        alt_text: 'Plan Item generation flow',
        caption: 'Plan Item generation flow',
      }),
    );
    render(
      <EditableEditor
        allowedBlocks={['paragraph', 'heading', 'link', 'image']}
        objectRef={{ type: 'requirement', id: 'req-plan-item-governance' }}
        onChange={onChange}
        onUploadAttachment={onUploadAttachment}
        value=""
      />,
    );

    const editor = screen.getByRole('textbox', { name: /markdown editor/i });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [new File(['image'], 'flow.png', { type: 'image/png' })],
        getData: () => '',
      },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.stringContaining('attachment://att-plan-flow')));
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('![Plan Item generation flow](attachment://att-plan-flow "Plan Item generation flow")'));
    expect(onUploadAttachment).toHaveBeenCalledWith(expect.any(File), { type: 'requirement', id: 'req-plan-item-governance' });
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

  it('persists dropped and file-picker image refs with alt text and caption metadata', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onUploadAttachment = vi
      .fn()
      .mockImplementationOnce(async (file: File, objectRef) =>
        publicAttachmentFixture({
          id: 'att-file-picker-flow',
          owner_object_type: objectRef.type,
          owner_object_id: objectRef.id,
          filename: file.name,
          content_type: file.type,
          alt_text: 'Plan Item file picker flow',
          caption: 'Plan Item file picker flow',
        }),
      )
      .mockImplementationOnce(async (file: File, objectRef) =>
        publicAttachmentFixture({
          id: 'att-drop-flow',
          owner_object_type: objectRef.type,
          owner_object_id: objectRef.id,
          filename: file.name,
          content_type: file.type,
          alt_text: 'Plan Item dropped flow',
          caption: 'Plan Item dropped flow',
        }),
      );

    render(
      <EditableEditor
        allowedBlocks={['paragraph', 'heading', 'link', 'image']}
        objectRef={{ type: 'requirement', id: 'req-plan-item-governance' }}
        onChange={onChange}
        onUploadAttachment={onUploadAttachment}
        value=""
      />,
    );

    await user.click(screen.getByRole('button', { name: /insert image/i }));
    await uploadFile(screen.getByLabelText(/image file/i), new File(['image'], 'picker.png', { type: 'image/png' }));
    await dropImage(screen.getByRole('textbox', { name: /markdown editor/i }), new File(['image'], 'drop.png', { type: 'image/png' }));

    await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledTimes(2));
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('attachment://att-file-picker-flow'));
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('attachment://att-drop-flow'));
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('![Plan Item file picker flow](attachment://att-file-picker-flow "Plan Item file picker flow")'));
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('![Plan Item dropped flow](attachment://att-drop-flow "Plan Item dropped flow")'));
  });

  it('keeps document-workspace edits recoverable after failed upload and failed save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(undefined);
    const onUploadAttachment = vi
      .fn()
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce(
        publicAttachmentFixture({
          id: 'att-source-recovered',
          owner_object_type: 'requirement',
          owner_object_id: 'req-plan-item-governance',
          filename: 'recovered.png',
          content_type: 'image/png',
          alt_text: 'Recovered planning input image',
        }),
      );

    render(
      <EditableEditor
        allowedBlocks={['paragraph', 'heading', 'link', 'image']}
        guardRouteTransitions
        objectRef={{ type: 'requirement', id: 'req-plan-item-governance' }}
        onSave={onSave}
        onUploadAttachment={onUploadAttachment}
        value="Initial requirement narrative"
      />,
    );

    await pasteImage(screen.getByRole('textbox', { name: /markdown editor/i }));
    expect(await screen.findByText(/upload failed/i)).toBeTruthy();

    await pasteImage(screen.getByRole('textbox', { name: /markdown editor/i }));
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: /markdown editor/i }) as HTMLTextAreaElement).value).toContain('attachment://att-source-recovered'),
    );

    await user.type(screen.getByRole('textbox', { name: /markdown editor/i }), '\nRecoverable source edit');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/save failed/i)).toBeTruthy();
    expect((screen.getByRole('textbox', { name: /markdown editor/i }) as HTMLTextAreaElement).value).toContain('Recoverable source edit');

    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  });

  it('keeps Spec and Implementation Plan Doc image refs stable across failed upload and recovery', async () => {
    const onChange = vi.fn();
    const onUploadAttachment = vi
      .fn()
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce(
        publicAttachmentFixture({
          id: 'att-gate-state',
          owner_object_type: 'spec_revision',
          owner_object_id: 'specrev-cockpit-command-center-v1',
          filename: 'gate.png',
          content_type: 'image/png',
          alt_text: 'Gate state diagram',
        }),
      );

    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph', 'heading', 'link', 'image', 'table', 'code_block', 'inline_code']}
        mode="edit"
        objectRef={{ type: 'spec_revision', id: 'specrev-cockpit-command-center-v1', spec_id: 'spec-cockpit-command-center' }}
        onChange={onChange}
        onUploadAttachment={onUploadAttachment}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="## Spec"
        attachments={[]}
      />,
    );

    await pasteImage(screen.getByRole('textbox', { name: /markdown editor/i }));
    expect(await screen.findByText(/upload failed/i)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining('attachment://'));

    await pasteImage(screen.getByRole('textbox', { name: /markdown editor/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.stringContaining('attachment://att-gate-state')));
    expect(onUploadAttachment).toHaveBeenLastCalledWith(expect.any(File), {
      type: 'spec_revision',
      id: 'specrev-cockpit-command-center-v1',
      spec_id: 'spec-cockpit-command-center',
    });
  });

  it('keeps item-scoped document image refs stable for drop and file-picker insertion', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onUploadAttachment = vi
      .fn()
      .mockResolvedValueOnce(
          publicAttachmentFixture({
            id: 'att-implementation-plan-doc-drop',
            owner_object_type: 'implementation_plan_revision',
            owner_object_id: 'planrev-requirements-database-view-v1',
          filename: 'drop.png',
          content_type: 'image/png',
          alt_text: 'Implementation Plan Doc dropped image',
        }),
      )
      .mockResolvedValueOnce(
          publicAttachmentFixture({
            id: 'att-implementation-plan-doc-picker',
            owner_object_type: 'implementation_plan_revision',
            owner_object_id: 'planrev-requirements-database-view-v1',
          filename: 'picker.png',
          content_type: 'image/png',
          alt_text: 'Implementation Plan Doc picker image',
        }),
      );

    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph', 'heading', 'link', 'image', 'table', 'code_block', 'inline_code']}
        mode="edit"
        objectRef={{
          type: 'implementation_plan_revision',
          id: 'planrev-requirements-database-view-v1',
          implementation_plan_id: 'plan-requirements-database-view',
        }}
        onChange={onChange}
        onUploadAttachment={onUploadAttachment}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="## Implementation Plan Doc"
        attachments={[]}
      />,
    );

    await dropImage(screen.getByRole('textbox', { name: /markdown editor/i }), new File(['image'], 'drop.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: /insert image/i }));
    await uploadFile(screen.getByLabelText(/image file/i), new File(['image'], 'picker.png', { type: 'image/png' }));

    await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledTimes(2));
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('attachment://att-implementation-plan-doc-drop'));
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('attachment://att-implementation-plan-doc-picker'));
  });

  it('keeps item-scoped document edits recoverable after failed draft save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(undefined);

    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph', 'heading', 'link', 'image', 'table', 'code_block', 'inline_code']}
        mode="edit"
        objectRef={{ type: 'spec_revision', id: 'specrev-cockpit-command-center-v1', spec_id: 'spec-cockpit-command-center' }}
        onChange={vi.fn()}
        onSave={onSave}
        onUploadAttachment={vi.fn()}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="## Spec"
        attachments={[]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /source mode/i }));
    await user.type(screen.getByRole('textbox', { name: /markdown source/i }), '\nRecoverable draft note');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/save failed/i)).toBeTruthy();
    expect((screen.getByRole('textbox', { name: /markdown source/i }) as HTMLTextAreaElement).value).toContain('Recoverable draft note');

    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
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

  it('does not expose image insertion on pre-created planning input authoring routes', async () => {
    const rendered = await renderRoute('/requirements/new');

    expect(await rendered.findByRole('heading', { name: 'New Requirement' })).toBeTruthy();
    expect(rendered.queryByRole('button', { name: /insert image/i })).toBeNull();
    expect(rendered.queryByLabelText(/image file/i)).toBeNull();
    expect(rendered.getByRole('region', { name: /narrative document/i })).toBeTruthy();
    expect(rendered.queryByRole('textbox', { name: /narrative markdown/i })).toBeNull();
  });
});
