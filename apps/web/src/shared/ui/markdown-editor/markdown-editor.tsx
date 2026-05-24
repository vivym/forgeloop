import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useBlocker, useInRouterContext } from 'react-router';
import {
  MDXEditor,
  diffSourcePlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  type MDXEditorMethods,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { Code2, FileImage, History, Paperclip, Save } from 'lucide-react';
import type {
  AttachmentRef,
  EditableObjectRef,
  MarkdownBlockKind,
  MarkdownDocument,
  MarkdownValidationIssue,
} from '@forgeloop/contracts';

import { cn } from '../../utils/cn';
import { attachmentMarkdownFor } from './attachment-plugin';
import { validateEditorMarkdown } from './markdown-policy';

export interface MarkdownRevision {
  revision_id: string;
  markdown: string;
  created_at: string;
  author_actor_id?: string;
}

export interface ForgeMarkdownEditorProps {
  value: string;
  mode: 'read' | 'edit';
  objectRef: EditableObjectRef;
  allowedBlocks: MarkdownBlockKind[];
  validationPolicy: { validation_version: string };
  attachments?: AttachmentRef[];
  revisions?: MarkdownRevision[];
  autosave?: {
    debounceMs: number;
    onAutosaveDraft: (markdown: string) => void;
  };
  onChange: (markdown: string) => void;
  onSave?: (document: MarkdownDocument) => void | Promise<void>;
  onUploadAttachment: (file: File, objectRef: EditableObjectRef) => Promise<AttachmentRef>;
}

export function ForgeMarkdownEditor({
  allowedBlocks,
  attachments = [],
  autosave,
  mode,
  objectRef,
  onChange,
  onSave,
  onUploadAttachment,
  revisions = [],
  validationPolicy,
  value,
}: ForgeMarkdownEditorProps) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const objectKey = editableObjectKey(objectRef);
  const objectKeyRef = useRef(objectKey);
  const draftRef = useRef(value);
  const savedValueRef = useRef(value);
  const [draft, setDraft] = useState(value);
  const [savedValue, setSavedValue] = useState(value);
  const [uploadedAttachments, setUploadedAttachments] = useState<AttachmentRef[]>([]);
  const [sourceMode, setSourceMode] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const [diffSelection, setDiffSelection] = useState<{ before: MarkdownRevision; after: MarkdownRevision }>();
  const [validationIssues, setValidationIssues] = useState<MarkdownValidationIssue[]>([]);
  const [uploadError, setUploadError] = useState<string>();

  const richEditorEnabled = mode === 'edit' && !sourceMode && isBrowserRuntime() && !isJsdomRuntime();
  const documentAttachments = mergeAttachmentRefs(attachments, uploadedAttachments);
  const dirty = draft !== savedValue;

  useEffect(() => {
    const objectChanged = objectKeyRef.current !== objectKey;
    const localDirty = draftRef.current !== savedValueRef.current;
    objectKeyRef.current = objectKey;

    if (objectChanged) {
      draftRef.current = value;
      savedValueRef.current = value;
      setDraft(value);
      setSavedValue(value);
      setUploadedAttachments([]);
      editorRef.current?.setMarkdown(value);
      return;
    }

    if (!localDirty) {
      draftRef.current = value;
      savedValueRef.current = value;
      setDraft(value);
      setSavedValue(value);
      editorRef.current?.setMarkdown(value);
    }
  }, [objectKey, value]);

  useEffect(() => {
    if (mode !== 'edit' || !isBrowserRuntime()) return;

    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, mode]);

  useEffect(() => {
    if (!autosave || !dirty || mode !== 'edit') return;

    const timer = window.setTimeout(() => autosave.onAutosaveDraft(draft), autosave.debounceMs);
    return () => window.clearTimeout(timer);
  }, [autosave, draft, dirty, mode]);

  function updateDraft(nextDraft: string) {
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setValidationIssues([]);
    onChange(nextDraft);
  }

  async function uploadImage(file: File): Promise<string> {
    const attachment = await uploadAttachment(file);
    return `attachment://${attachment.id}`;
  }

  async function uploadAttachment(file: File): Promise<AttachmentRef> {
    setUploadError(undefined);
    try {
      const attachment = await onUploadAttachment(file, objectRef);
      setUploadedAttachments((current) => mergeAttachmentRefs(current, [attachment]));
      return attachment;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUploadError(message);
      throw error;
    }
  }

  async function appendUploadedImage(file: File) {
    try {
      const attachment = await uploadAttachment(file);
      appendMarkdown(attachmentMarkdownFor(attachment));
    } catch {
      // The visible upload error is set in uploadAttachment.
    }
  }

  function appendMarkdown(markdown: string) {
    const currentDraft = draftRef.current;
    const separator = currentDraft.trim().length === 0 || currentDraft.endsWith('\n') ? '' : '\n\n';
    const nextDraft = `${currentDraft}${separator}${markdown}`;
    updateDraft(nextDraft);
    editorRef.current?.setMarkdown(nextDraft);
  }

  async function handlePaste(event: ClipboardEvent<HTMLElement>) {
    const image = Array.from(event.clipboardData.files ?? []).find((file) => file.type.startsWith('image/'));
    if (image === undefined) return;

    event.preventDefault();
    await appendUploadedImage(image);
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    const image = Array.from(event.dataTransfer.files ?? []).find((file) => file.type.startsWith('image/'));
    if (image === undefined) return;

    event.preventDefault();
    await appendUploadedImage(image);
  }

  async function handleImageFileChange(file: File | undefined) {
    if (file === undefined) return;
    await appendUploadedImage(file);
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  }

  async function handleSave() {
    if (onSave === undefined) return;

    const validation = validateEditorMarkdown({
      markdown: draft,
      objectRef,
      allowedBlocks,
      attachments: documentAttachments,
      validationVersion: validationPolicy.validation_version,
    });

    if (!validation.ok) {
      setValidationIssues(validation.issues);
      return;
    }

    const document: MarkdownDocument = {
      markdown: validation.markdown,
      object_ref: objectRef,
      allowed_blocks: allowedBlocks,
      attachment_refs: documentAttachments,
      validation_version: validationPolicy.validation_version,
    };
    await onSave(document);
    savedValueRef.current = validation.markdown;
    setSavedValue(validation.markdown);
  }

  const mdxPlugins = [
    headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4] }),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    tablePlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    imagePlugin({ imageUploadHandler: uploadImage }),
    diffSourcePlugin({ viewMode: sourceMode ? 'source' : 'rich-text' }),
    toolbarPlugin({ toolbarContents: () => null, toolbarClassName: 'sr-only' }),
    markdownShortcutPlugin(),
  ];

  if (mode === 'read') {
    return <MarkdownPreview markdown={value} />;
  }

  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-surface p-3"
      onDrop={(event) => {
        if (shouldHandleContainerFileEvent(event)) void handleDrop(event);
      }}
      onPaste={(event) => {
        if (shouldHandleContainerFileEvent(event)) void handlePaste(event);
      }}
    >
      <div aria-label="Editor toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          aria-label={sourceMode ? 'Rich mode' : 'Source mode'}
          className={toolbarButtonClass}
          onClick={() => setSourceMode((current) => !current)}
          type="button"
        >
          <Code2 aria-hidden="true" className="size-4" />
          {sourceMode ? 'Rich text' : 'Source'}
        </button>
        <button
          aria-label="Insert image"
          className={toolbarButtonClass}
          onClick={() => imageInputRef.current?.click()}
          type="button"
        >
          <FileImage aria-hidden="true" className="size-4" />
          Insert image
        </button>
        <label className="sr-only">
          Image file
          <input
            ref={imageInputRef}
            aria-label="Image file"
            accept="image/*"
            onChange={(event) => void handleImageFileChange(event.currentTarget.files?.[0])}
            type="file"
          />
        </label>
        <button
          aria-controls="forge-markdown-editor-attachments"
          aria-expanded={showAttachments}
          aria-label="Attachments"
          className={toolbarButtonClass}
          onClick={() => setShowAttachments((current) => !current)}
          type="button"
        >
          <Paperclip aria-hidden="true" className="size-4" />
          Attachments
        </button>
        <button
          aria-controls="forge-markdown-editor-revisions"
          aria-expanded={showRevisions}
          aria-label="Revisions - revision history"
          className={toolbarButtonClass}
          onClick={() => setShowRevisions((current) => !current)}
          type="button"
        >
          <History aria-hidden="true" className="size-4" />
          Revisions
        </button>
        <button
          aria-label="Save"
          className={`${toolbarButtonClass} ml-auto border-primary bg-primary font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50`}
          disabled={onSave === undefined}
          onClick={() => void handleSave()}
          type="button"
        >
          <Save aria-hidden="true" className="size-4" />
          Save
        </button>
      </div>

      {showAttachments ? (
        <div
          aria-label="Attachments"
          className="rounded-md border border-border bg-surface-muted p-2"
          id="forge-markdown-editor-attachments"
          role="menu"
        >
          {attachments.length === 0 ? <p className="text-sm text-text-muted">No attachments</p> : null}
          {attachments.map((attachment) => (
            <button
              className="block w-full rounded px-2 py-1 text-left text-sm text-text-primary hover:bg-surface"
              key={attachment.id}
              onClick={() => {
                appendMarkdown(attachmentMarkdownFor(attachment));
                setShowAttachments(false);
              }}
              role="menuitem"
              type="button"
            >
              {attachment.filename}
            </button>
          ))}
        </div>
      ) : null}

      {richEditorEnabled ? (
        <MDXEditor
          ref={editorRef}
          className="min-h-64 rounded-md border border-border bg-surface p-3"
          markdown={draft}
          onChange={(nextMarkdown, initialMarkdownNormalize) => {
            if (!initialMarkdownNormalize) updateDraft(nextMarkdown);
          }}
          plugins={mdxPlugins}
          suppressHtmlProcessing
        />
      ) : (
        <textarea
          aria-label={sourceMode ? 'Markdown source' : 'Markdown editor'}
          className="min-h-64 w-full resize-y rounded-md border border-border bg-surface p-3 font-mono text-sm text-text-primary outline-none focus:border-primary"
          onChange={(event) => updateDraft(event.currentTarget.value)}
          value={draft}
        />
      )}

      <EditorFeedback issues={validationIssues} uploadError={uploadError} />

      {showRevisions ? (
        <RevisionHistory
          id="forge-markdown-editor-revisions"
          revisions={revisions}
          selected={diffSelection}
          onSelectDiff={(before, after) => setDiffSelection({ before, after })}
        />
      ) : null}

      <RouteTransitionGuard enabled={dirty && mode === 'edit'} />
    </section>
  );
}

const toolbarButtonClass =
  'inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

function RouteTransitionGuard({ enabled }: { enabled: boolean }) {
  const inRouterContext = useInRouterContext();
  return inRouterContext ? <RouterTransitionBlocker enabled={enabled} /> : null;
}

function RouterTransitionBlocker({ enabled }: { enabled: boolean }) {
  const blocker = useBlocker(enabled);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;

    if (window.confirm('Discard unsaved Markdown changes?')) {
      blocker.proceed();
      return;
    }

    blocker.reset();
  }, [blocker]);

  return null;
}

function EditorFeedback({ issues, uploadError }: { issues: MarkdownValidationIssue[]; uploadError: string | undefined }) {
  if (issues.length === 0 && uploadError === undefined) return null;

  return (
    <div className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger" role="alert">
      {uploadError === undefined ? null : <p>{uploadError}</p>}
      {issues.map((issue) => (
        <p key={`${issue.code}-${issue.message}`}>{`${issue.code}: ${issue.message}`}</p>
      ))}
    </div>
  );
}

function RevisionHistory({
  id,
  onSelectDiff,
  revisions,
  selected,
}: {
  id: string;
  revisions: MarkdownRevision[];
  selected: { before: MarkdownRevision; after: MarkdownRevision } | undefined;
  onSelectDiff: (before: MarkdownRevision, after: MarkdownRevision) => void;
}) {
  return (
    <aside aria-label="Revisions" className="rounded-md border border-border bg-surface-muted p-3" id={id}>
      <div className="flex flex-col gap-2">
        {revisions.slice(1).map((revision, index) => {
          const before = revisions[index];
          if (before === undefined) return null;
          return (
            <button
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-left text-sm text-text-secondary hover:bg-surface-muted"
              key={`${before.revision_id}-${revision.revision_id}`}
              onClick={() => onSelectDiff(before, revision)}
              type="button"
            >
              {`Compare ${before.revision_id} to ${revision.revision_id}`}
            </button>
          );
        })}
      </div>
      {selected === undefined ? null : (
        <RevisionDiff after={selected.after} before={selected.before} />
      )}
    </aside>
  );
}

type RevisionDiffLine = {
  kind: 'added' | 'removed' | 'unchanged';
  text: string;
};

function RevisionDiff({ after, before }: { after: MarkdownRevision; before: MarkdownRevision }) {
  return (
    <section
      aria-label={`Markdown diff ${before.revision_id} to ${after.revision_id}`}
      className="mt-3 rounded-md border border-border bg-surface p-3"
      role="region"
    >
      <div className="flex flex-col gap-1">
        {diffMarkdownLines(before.markdown, after.markdown).map((line, index) => (
          <div
            className={cn(
              'grid grid-cols-[5rem_minmax(0,1fr)] gap-3 rounded px-2 py-1 text-sm',
              line.kind === 'added' ? 'bg-success/10 text-success' : undefined,
              line.kind === 'removed' ? 'bg-danger/10 text-danger' : undefined,
              line.kind === 'unchanged' ? 'text-text-muted' : undefined,
            )}
            key={`${line.kind}-${index}-${line.text}`}
          >
            <span className="text-xs font-semibold uppercase tracking-wide">{diffLineLabel(line.kind)}</span>
            <pre className="whitespace-pre-wrap break-words font-mono">{line.text || ' '}</pre>
          </div>
        ))}
      </div>
    </section>
  );
}

function diffLineLabel(kind: RevisionDiffLine['kind']) {
  switch (kind) {
    case 'added':
      return 'Added';
    case 'removed':
      return 'Removed';
    case 'unchanged':
      return 'Same';
  }
}

function diffMarkdownLines(beforeMarkdown: string, afterMarkdown: string): RevisionDiffLine[] {
  const before = splitMarkdownLines(beforeMarkdown);
  const after = splitMarkdownLines(afterMarkdown);
  const lcs = Array.from({ length: before.length + 1 }, () => Array<number>(after.length + 1).fill(0));

  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lcs[beforeIndex]![afterIndex] =
        before[beforeIndex] === after[afterIndex]
          ? (lcs[beforeIndex + 1]?.[afterIndex + 1] ?? 0) + 1
          : Math.max(lcs[beforeIndex + 1]?.[afterIndex] ?? 0, lcs[beforeIndex]?.[afterIndex + 1] ?? 0);
    }
  }

  const diff: RevisionDiffLine[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < before.length || afterIndex < after.length) {
    if (beforeIndex < before.length && afterIndex < after.length && before[beforeIndex] === after[afterIndex]) {
      diff.push({ kind: 'unchanged', text: before[beforeIndex] ?? '' });
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    if (
      afterIndex < after.length &&
      (beforeIndex >= before.length ||
        (lcs[beforeIndex]?.[afterIndex + 1] ?? 0) >= (lcs[beforeIndex + 1]?.[afterIndex] ?? 0))
    ) {
      diff.push({ kind: 'added', text: after[afterIndex] ?? '' });
      afterIndex += 1;
      continue;
    }

    if (beforeIndex < before.length) {
      diff.push({ kind: 'removed', text: before[beforeIndex] ?? '' });
      beforeIndex += 1;
    }
  }

  return diff;
}

function splitMarkdownLines(markdown: string) {
  return markdown.split(/\r?\n/);
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  return (
    <article className="prose prose-sm max-w-none text-text-primary">
      {markdownToBlocks(markdown).map((block, index) => (
        <MarkdownBlock block={block} key={`${block.kind}-${index}`} />
      ))}
    </article>
  );
}

type MarkdownPreviewBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { kind: 'paragraph'; text: string };

function MarkdownBlock({ block }: { block: MarkdownPreviewBlock }) {
  if (block.kind === 'paragraph') {
    return <p>{block.text}</p>;
  }

  const className = cn('font-semibold text-text-primary', block.level === 1 ? 'text-2xl' : 'text-lg');
  switch (block.level) {
    case 1:
      return <h1 className={className}>{block.text}</h1>;
    case 2:
      return <h2 className={className}>{block.text}</h2>;
    case 3:
      return <h3 className={className}>{block.text}</h3>;
    case 4:
      return <h4 className={className}>{block.text}</h4>;
  }
}

function markdownToBlocks(markdown: string): MarkdownPreviewBlock[] {
  const blocks: MarkdownPreviewBlock[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading !== null) {
      const marker = heading[1] ?? '#';
      blocks.push({ kind: 'heading', level: marker.length as 1 | 2 | 3 | 4, text: heading[2] ?? '' });
      continue;
    }

    blocks.push({ kind: 'paragraph', text: trimmed });
  }
  return blocks;
}

function isBrowserRuntime() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function isJsdomRuntime() {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
}

function editableObjectKey(objectRef: EditableObjectRef) {
  return `${objectRef.type}:${objectRef.id}`;
}

function mergeAttachmentRefs(existing: AttachmentRef[], incoming: AttachmentRef[]) {
  const merged = [...existing];
  const seen = new Set(existing.map((attachment) => attachment.id));
  for (const attachment of incoming) {
    if (seen.has(attachment.id)) continue;
    merged.push(attachment);
    seen.add(attachment.id);
  }
  return merged;
}

function shouldHandleContainerFileEvent(event: ClipboardEvent<HTMLElement> | DragEvent<HTMLElement>) {
  return !event.defaultPrevented && event.target instanceof HTMLTextAreaElement;
}
