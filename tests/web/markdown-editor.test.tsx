// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Link, createRoutesStub } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentRef } from '@forgeloop/contracts';

import { ForgeMarkdownEditor } from '../../apps/web/src/shared/ui/markdown-editor';

const publicAttachmentFixture = (overrides: Partial<AttachmentRef> = {}): AttachmentRef => ({
  id: 'att-1',
  owner_object_type: 'requirement',
  owner_object_id: 'req-plan-item-governance',
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

describe('ForgeMarkdownEditor', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps MDXEditor behind ForgeMarkdownEditor and supports source mode, image upload, attachments, and revision affordances', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onUploadAttachment = vi.fn().mockResolvedValue({
      id: 'attachment-image-1',
      filename: 'diagram.png',
      content_type: 'image/png',
      reference_status: 'active',
      safety_status: 'passed',
      alt_text: 'Boundary diagram',
    });

    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph', 'image', 'link']}
        attachments={[
          {
            id: 'attachment-doc-1',
            filename: 'notes.md',
            content_type: 'text/markdown',
            reference_status: 'active',
            safety_status: 'passed',
          },
        ]}
        mode="edit"
        objectRef={{ type: 'requirement', id: 'req-1', driver_actor_id: 'actor-product' }}
        onChange={onChange}
        onSave={vi.fn()}
        onUploadAttachment={onUploadAttachment}
        revisions={[
          { revision_id: 'rev-1', markdown: 'Old body', created_at: '2026-05-22T00:00:00.000Z' },
          { revision_id: 'rev-2', markdown: 'New body', created_at: '2026-05-23T00:00:00.000Z' },
        ]}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="New body"
      />,
    );

    expect(screen.getByRole('button', { name: /source/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /insert image/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /attachments/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /revisions/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /save/i })).toBeTruthy();

    await user.upload(screen.getByLabelText(/image file/i), new File(['image'], 'diagram.png', { type: 'image/png' }));

    await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ type: 'requirement', id: 'req-1' })));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.stringContaining('![Boundary diagram](attachment://attachment-image-1)')));
  });

  it('supports keyboard operation and visible focus for editor toolbar controls', async () => {
    const user = userEvent.setup();
    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph', 'image']}
        attachments={[]}
        mode="edit"
        objectRef={{ type: 'requirement', id: 'req-1', driver_actor_id: 'actor-product' }}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onUploadAttachment={vi.fn()}
        revisions={[{ revision_id: 'rev-1', markdown: 'Initial', created_at: '2026-05-23T00:00:00.000Z' }]}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="Initial"
      />,
    );

    const sourceButton = screen.getByRole('button', { name: /source/i });
    expect(sourceButton.className).toMatch(/focus-visible:/);

    await user.tab();
    expect(document.activeElement).toBe(sourceButton);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: /markdown source/i })).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /insert image/i }));
  });

  it('renders read-only Markdown and hides editing toolbar', () => {
    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph', 'heading']}
        mode="read"
        objectRef={{ type: 'requirement', id: 'req-1', driver_actor_id: 'actor-product' }}
        onChange={vi.fn()}
        onUploadAttachment={vi.fn()}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="# Requirement brief"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Requirement brief' })).toBeTruthy();
    expect(screen.queryByLabelText(/editor toolbar/i)).toBeNull();
  });

  it('sanitizes unsafe script content while preserving code blocks, tables, links, and attachment image refs in preview', () => {
    const previewAttachment = publicAttachmentFixture({
      id: 'att-preview-flow',
      owner_object_type: 'requirement',
      owner_object_id: 'req-plan-item-governance',
      filename: 'flow.png',
      content_type: 'image/png',
      alt_text: 'Preview flow',
    });

    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph', 'heading', 'link', 'image', 'table', 'code_block', 'inline_code']}
        attachments={[previewAttachment]}
        mode="read"
        objectRef={{ type: 'requirement', id: 'req-plan-item-governance' }}
        onChange={vi.fn()}
        onUploadAttachment={vi.fn()}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value={[
          '# Requirement',
          '<script>alert(1)</script>',
          '[safe link](https://example.com)',
          '| Gate | State |',
          '| --- | --- |',
          '| Spec | Approved |',
          '```ts',
          'const value = "<script>kept as code text";',
          '```',
          '![Preview flow](attachment://att-preview-flow)',
        ].join('\n')}
      />,
    );

    expect(document.querySelector('script')).toBeNull();
    expect(screen.queryByText(/alert\(1\)/)).toBeNull();
    expect(screen.getByRole('link', { name: /safe link/i }).getAttribute('href')).toBe('https://example.com');
    expect(screen.getByRole('table').textContent).toMatch(/Spec/);
    expect(screen.getByText(/const value/)).toBeTruthy();
    expect(screen.getByRole('img', { name: /preview flow/i }).getAttribute('src')).toBe('attachment://att-preview-flow');
  });

  it('rejects unsafe source mode content before save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph', 'image']}
        mode="edit"
        objectRef={{ type: 'requirement', id: 'req-1', driver_actor_id: 'actor-product' }}
        onChange={vi.fn()}
        onSave={onSave}
        onUploadAttachment={vi.fn()}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="Initial"
      />,
    );

    await user.click(screen.getByRole('button', { name: /source/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown source/i }), {
      target: { value: '![bad](data:image/png;base64,aaaa)' },
    });
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByText(/unsafe/i).length).toBeGreaterThan(0);
  });

  it('autosaves drafts and guards navigation when edits are unsaved', async () => {
    const user = userEvent.setup();
    const onAutosaveDraft = vi.fn();
    const onBeforeUnload = vi.spyOn(window, 'addEventListener');
    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph']}
        autosave={{ debounceMs: 10, onAutosaveDraft }}
        mode="edit"
        objectRef={{ type: 'requirement', id: 'req-1' }}
        onChange={vi.fn()}
        onUploadAttachment={vi.fn()}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="Initial"
      />,
    );

    await user.type(screen.getByRole('textbox', { name: /markdown editor/i }), ' updated');

    await waitFor(() => expect(onAutosaveDraft).toHaveBeenCalledWith(expect.stringContaining('updated')));
    expect(onBeforeUnload).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });

  it('blocks in-app route transitions while edits are unsaved', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    function EditorRoute() {
      return (
        <>
          <ForgeMarkdownEditor
            allowedBlocks={['paragraph']}
            mode="edit"
            objectRef={{ type: 'requirement', id: 'req-1' }}
            onChange={vi.fn()}
            onUploadAttachment={vi.fn()}
            validationPolicy={{ validation_version: '2026-05-23' }}
            value="Initial"
          />
          <Link to="/next">Next page</Link>
        </>
      );
    }

    function NextRoute() {
      return <h1>Next page loaded</h1>;
    }

    const RoutesStub = createRoutesStub([
      { path: '/', Component: EditorRoute },
      { path: '/next', Component: NextRoute },
    ]);
    render(<RoutesStub initialEntries={['/']} />);

    await user.type(screen.getByRole('textbox', { name: /markdown editor/i }), ' updated');
    await user.click(screen.getByRole('link', { name: /next page/i }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: /next page loaded/i })).toBeNull();
    expect((screen.getByRole('textbox', { name: /markdown editor/i }) as HTMLTextAreaElement).value).toBe('Initial updated');
  });

  it('keeps unsaved state when a controlled parent rerenders with the draft value', async () => {
    const user = userEvent.setup();

    function ControlledEditor() {
      const [value, setValue] = useState('Initial');
      return (
        <ForgeMarkdownEditor
          allowedBlocks={['paragraph']}
          mode="edit"
          objectRef={{ type: 'requirement', id: 'req-1' }}
          onChange={setValue}
          onUploadAttachment={vi.fn()}
          validationPolicy={{ validation_version: '2026-05-23' }}
          value={value}
        />
      );
    }

    render(<ControlledEditor />);

    await user.type(screen.getByRole('textbox', { name: /markdown editor/i }), ' updated');
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: /markdown editor/i }) as HTMLTextAreaElement).value).toBe('Initial updated'),
    );

    const event = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('adopts same-object server value changes when the editor is clean', async () => {
    const user = userEvent.setup();

    function ServerBackedEditor() {
      const [value, setValue] = useState('Initial');
      return (
        <>
          <ForgeMarkdownEditor
            allowedBlocks={['paragraph']}
            mode="edit"
            objectRef={{ type: 'requirement', id: 'req-1' }}
            onChange={vi.fn()}
            onUploadAttachment={vi.fn()}
            validationPolicy={{ validation_version: '2026-05-23' }}
            value={value}
          />
          <button onClick={() => setValue('Server body')} type="button">
            Refresh from server
          </button>
        </>
      );
    }

    render(<ServerBackedEditor />);

    await user.click(screen.getByRole('button', { name: /refresh from server/i }));

    expect((screen.getByRole('textbox', { name: /markdown editor/i }) as HTMLTextAreaElement).value).toBe('Server body');
    const event = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not overwrite an unsaved same-object draft from incoming props', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const objectRef = { type: 'requirement' as const, id: 'req-1' };
    const { rerender } = render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph']}
        mode="edit"
        objectRef={objectRef}
        onChange={onChange}
        onUploadAttachment={vi.fn()}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="Initial"
      />,
    );

    await user.type(screen.getByRole('textbox', { name: /markdown editor/i }), ' local');
    rerender(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph']}
        mode="edit"
        objectRef={objectRef}
        onChange={onChange}
        onUploadAttachment={vi.fn()}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="Server stale body"
      />,
    );

    expect((screen.getByRole('textbox', { name: /markdown editor/i }) as HTMLTextAreaElement).value).toBe('Initial local');
  });

  it('does not clear unsaved protection when no save handler is present', async () => {
    const user = userEvent.setup();
    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph']}
        mode="edit"
        objectRef={{ type: 'requirement', id: 'req-1' }}
        onChange={vi.fn()}
        onUploadAttachment={vi.fn()}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="Initial"
      />,
    );

    await user.type(screen.getByRole('textbox', { name: /markdown editor/i }), ' unsaved');
    await user.click(screen.getByRole('button', { name: /save/i }));

    const event = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('shows revision history and Markdown diff without changing the saved body', async () => {
    const user = userEvent.setup();
    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph']}
        mode="edit"
        objectRef={{ type: 'requirement', id: 'req-1', driver_actor_id: 'actor-product' }}
        onChange={vi.fn()}
        onUploadAttachment={vi.fn()}
        revisions={[
          { revision_id: 'rev-1', markdown: 'Old body', created_at: '2026-05-22T00:00:00.000Z', author_actor_id: 'actor-product' },
          { revision_id: 'rev-2', markdown: 'New body', created_at: '2026-05-23T00:00:00.000Z', author_actor_id: 'actor-product' },
        ]}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="New body"
      />,
    );

    await user.click(screen.getByRole('button', { name: /revision history/i }));
    await user.click(screen.getByRole('button', { name: /compare rev-1 to rev-2/i }));

    expect(screen.getByRole('region', { name: /markdown diff rev-1 to rev-2/i })).toBeTruthy();
    expect(screen.getByText('Removed')).toBeTruthy();
    expect(screen.getByText('Added')).toBeTruthy();
    expect(screen.getByText(/Old body/)).toBeTruthy();
    expect(screen.getAllByText(/New body/).length).toBeGreaterThan(0);
    expect((screen.getByRole('textbox', { name: /markdown editor/i }) as HTMLTextAreaElement).value).toBe('New body');
  });
});
