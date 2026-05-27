import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Link, useBlocker, useInRouterContext, useNavigate } from 'react-router';
import type { EditableObjectRef, MarkdownBlockKind, MarkdownDocument } from '@forgeloop/contracts';

import { DocumentWorkspaceLayout, ProductPage, Section } from '../../shared/layout';
import { Button, Field, ForgeMarkdownEditor, InlineNotice, Input, Textarea } from '../../shared/ui';
import { SurfaceStateIndicator } from './surface-state';

type SourceAuthoringObjectType = 'bug' | 'initiative' | 'requirement' | 'tech_debt';
type SourceAuthoringObjectRef =
  | Extract<EditableObjectRef, { type: 'bug' }>
  | Extract<EditableObjectRef, { type: 'initiative' }>
  | Extract<EditableObjectRef, { type: 'requirement' }>
  | Extract<EditableObjectRef, { type: 'tech_debt' }>;

export interface ObjectFormField {
  defaultValue?: string;
  input: 'input' | 'textarea';
  label: string;
  name: string;
  required?: boolean;
}

export interface ObjectCreateFormProps {
  cancelHref: string;
  fields: ObjectFormField[];
  narrativeTemplate: string;
  objectType: SourceAuthoringObjectType;
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
  subtitle: string;
  title: string;
}

export function ObjectCreateForm({ cancelHref, fields, narrativeTemplate, objectType, onSubmit, subtitle, title }: ObjectCreateFormProps) {
  const navigate = useNavigate();
  const initialFieldValues = useMemo(() => Object.fromEntries(fields.map((field) => [field.name, field.defaultValue ?? ''])), [fields]);
  const initialNarrative = narrativeTemplate;
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(initialFieldValues);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [validationSummary, setValidationSummary] = useState<string[]>([]);
  const [narrativeMarkdown, setNarrativeMarkdown] = useState(initialNarrative);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const initialValuesRef = useRef({ fieldValues: initialFieldValues, narrativeMarkdown: initialNarrative });
  const intentionalExitRef = useRef(false);
  const dirty = fieldValuesChanged(fieldValues, initialValuesRef.current.fieldValues) || narrativeMarkdown !== initialValuesRef.current.narrativeMarkdown;

  useEffect(() => {
    const nextValues = Object.fromEntries(fields.map((field) => [field.name, field.defaultValue ?? '']));
    initialValuesRef.current = { fieldValues: nextValues, narrativeMarkdown: narrativeTemplate };
    setFieldValues(nextValues);
    setNarrativeMarkdown(narrativeTemplate);
    setFieldErrors({});
    setValidationSummary([]);
    setSubmitAttempted(false);
  }, [fields, narrativeTemplate]);

  function updateField(name: string, value: string) {
    setFieldValues((current) => ({ ...current, [name]: value }));
    if (submitAttempted) {
      setFieldErrors((current) => {
        if (current[name] === undefined) return current;
        const nextErrors = { ...current };
        delete nextErrors[name];
        return nextErrors;
      });
      setValidationSummary((current) => current.filter((message) => !message.toLowerCase().includes(`${name.replace(/_/g, ' ')} is required`)));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAttempted(true);

    const nextErrors: Record<string, string> = {};
    const nextSummary: string[] = [];
    for (const field of fields) {
      if (field.required === true && fieldValues[field.name]?.trim().length === 0) {
        const message = `${field.label} is required.`;
        nextErrors[field.name] = message;
        nextSummary.push(message);
      }
    }

    setFieldErrors(nextErrors);
    setValidationSummary(nextSummary);
    if (nextSummary.length > 0) return;

    intentionalExitRef.current = true;
    try {
      await onSubmit({
        ...fieldValues,
        narrative_markdown: narrativeMarkdown,
      });
    } catch (error) {
      intentionalExitRef.current = false;
      throw error;
    }
  }

  function handleCancelClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!dirty) return;
    event.preventDefault();
    if (!window.confirm('Discard unsaved source object draft changes?')) return;
    intentionalExitRef.current = true;
    void navigate(cancelHref);
  }

  const objectLabel = sourceObjectLabel(objectType);

  return (
    <ProductPage family="source-document" heading={title}>
      <DiscardChangesPrompt bypassRef={intentionalExitRef} enabled={dirty} />
      <DocumentWorkspaceLayout
        document={
          <form className="grid gap-6" noValidate onSubmit={(event) => void handleSubmit(event)}>
            <Section aria-label="Structured intake" description={subtitle} title="Structured intake" variant="panel">
              <div className="grid gap-4 md:grid-cols-2">
                {fields.map((field) => (
                  <Field
                    key={field.name}
                    error={fieldErrors[field.name]}
                    label={field.label}
                    {...(field.input === 'textarea' ? { className: 'md:col-span-2' } : {})}
                    {...(field.required === undefined ? {} : { required: field.required })}
                  >
                    {field.input === 'textarea' ? (
                      <Textarea
                        name={field.name}
                        required={field.required}
                        value={fieldValues[field.name] ?? ''}
                        onChange={(event) => updateField(field.name, event.currentTarget.value)}
                      />
                    ) : (
                      <Input
                        name={field.name}
                        required={field.required}
                        value={fieldValues[field.name] ?? ''}
                        onChange={(event) => updateField(field.name, event.currentTarget.value)}
                      />
                    )}
                  </Field>
                ))}
              </div>
            </Section>
            <NarrativeDocumentField objectType={objectType} value={narrativeMarkdown} onChange={setNarrativeMarkdown} />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary">
                Create
              </Button>
              <Link
                className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-semibold text-text-primary"
                onClick={handleCancelClick}
                to={cancelHref}
              >
                Cancel
              </Link>
            </div>
          </form>
        }
        properties={
          <div className="grid gap-3">
            <Section title="Authoring state" variant="subtle">
              <div className="grid gap-3 text-sm text-text-secondary">
                <SurfaceStateIndicator label={title} state={validationSummary.length > 0 ? 'blocked' : 'approved'} />
                <p className="m-0">{dirty ? 'Draft changes not saved' : 'Ready to author source context'}</p>
                <p className="m-0">Complete required fields, attach narrative context, then create the source object.</p>
                <p className="m-0">{`${objectLabel} driver owns source intent; product and technical reviewers consume it through Development Plans.`}</p>
                <p className="m-0">
                  {validationSummary.length > 0 ? `Blocked by ${validationSummary.length} validation issue(s).` : 'No authoring blockers in the draft.'}
                </p>
              </div>
            </Section>
            {dirty ? <InlineNotice title="Draft changes" description="Structured fields or narrative edits are not saved yet." tone="info" /> : null}
            {validationSummary.length > 0 ? (
              <InlineNotice
                aria-label="Validation summary"
                description={<ul className="list-disc gap-1 pl-5">{validationSummary.map((message) => <li key={message}>{message}</li>)}</ul>}
                title="Validation summary"
                tone="danger"
              />
            ) : null}
          </div>
        }
      />
    </ProductPage>
  );
}

function sourceObjectLabel(objectType: SourceAuthoringObjectType): string {
  if (objectType === 'tech_debt') return 'Tech Debt';
  return objectType.replace(/\b\w/g, (match) => match.toUpperCase());
}

const createNarrativeBlocks: MarkdownBlockKind[] = ['paragraph', 'heading', 'list', 'blockquote', 'horizontal_rule', 'table', 'link'];

export function createNarrativeDocument(input: {
  markdown: string | undefined;
  objectRef: EditableObjectRef;
}): MarkdownDocument {
  return {
    markdown: input.markdown ?? '',
    object_ref: input.objectRef,
    allowed_blocks: createNarrativeBlocks,
    attachment_refs: [],
    validation_version: '2026-05-23',
  };
}

export function appendNarrativeSection(markdown: string | undefined, heading: string, body: string | undefined): string {
  const trimmedBody = body?.trim();
  if (!trimmedBody) return markdown ?? '';
  const trimmedMarkdown = (markdown ?? '').trimEnd();
  const section = `## ${heading}\n\n${trimmedBody}`;
  return trimmedMarkdown ? `${trimmedMarkdown}\n\n${section}` : section;
}

function NarrativeDocumentField({
  objectType,
  onChange,
  value,
}: {
  objectType: SourceAuthoringObjectType;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <section aria-label="Source narrative document" className="grid gap-3 rounded-md border border-border bg-surface p-4">
      <div className="grid gap-1">
        <h2 className="text-base font-semibold text-text-primary">Source narrative document</h2>
        <p className="text-sm text-text-secondary">Author the Markdown source narrative; image evidence becomes available after the source object exists.</p>
      </div>
      <ForgeMarkdownEditor
        allowedBlocks={createNarrativeBlocks}
        guardRouteTransitions={false}
        mode="edit"
        objectRef={draftSourceObjectRef(objectType)}
        onChange={onChange}
        onUploadAttachment={async () => {
          throw new Error('Image uploads are available after the source object is created.');
        }}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value={value}
      />
    </section>
  );
}

function draftSourceObjectRef(type: SourceAuthoringObjectType): SourceAuthoringObjectRef {
  switch (type) {
    case 'bug':
      return { type, id: 'draft-source-object' };
    case 'initiative':
      return { type, id: 'draft-source-object' };
    case 'requirement':
      return { type, id: 'draft-source-object' };
    case 'tech_debt':
      return { type, id: 'draft-source-object' };
  }
}

function fieldValuesChanged(current: Record<string, string>, initial: Record<string, string>) {
  const currentKeys = Object.keys(current);
  const initialKeys = Object.keys(initial);
  if (currentKeys.length !== initialKeys.length) return true;
  return currentKeys.some((key) => (current[key] ?? '') !== (initial[key] ?? ''));
}

function DiscardChangesPrompt({ bypassRef, enabled }: { bypassRef: { current: boolean }; enabled: boolean }) {
  const inRouterContext = useInRouterContext();
  return inRouterContext ? <DiscardChangesBlocker bypassRef={bypassRef} enabled={enabled} /> : null;
}

function DiscardChangesBlocker({ bypassRef, enabled }: { bypassRef: { current: boolean }; enabled: boolean }) {
  const blocker = useBlocker(() => enabled && !bypassRef.current);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Discard unsaved source object draft changes?')) {
      bypassRef.current = true;
      blocker.proceed();
      return;
    }
    blocker.reset();
  }, [blocker]);

  return null;
}
