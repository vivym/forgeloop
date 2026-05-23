import { Link } from 'react-router';
import type { EditableObjectRef, MarkdownBlockKind, MarkdownDocument } from '@forgeloop/contracts';

import { PageHeader, Section } from '../../shared/layout';
import { Button, Field, Input, Textarea } from '../../shared/ui';

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
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
  subtitle: string;
  title: string;
}

export function ObjectCreateForm({ cancelHref, fields, narrativeTemplate, onSubmit, subtitle, title }: ObjectCreateFormProps) {
  return (
    <>
      <PageHeader subtitle={subtitle} title={title} />
      <Section title="Structured intake">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void onSubmit(Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value)])));
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {fields.map((field) => (
              <Field
                key={field.name}
                label={field.label}
                {...(field.input === 'textarea' ? { className: 'md:col-span-2' } : {})}
                {...(field.required === undefined ? {} : { required: field.required })}
              >
                {field.input === 'textarea' ? (
                  <Textarea defaultValue={field.defaultValue} name={field.name} required={field.required} />
                ) : (
                  <Input defaultValue={field.defaultValue} name={field.name} required={field.required} />
                )}
              </Field>
            ))}
          </div>
          <Field label="Narrative Markdown">
            <Textarea defaultValue={narrativeTemplate} name="narrative_markdown" />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary">Create</Button>
            <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-semibold text-text-primary" to={cancelHref}>
              Cancel
            </Link>
          </div>
        </form>
      </Section>
    </>
  );
}

const createNarrativeBlocks: MarkdownBlockKind[] = ['paragraph', 'heading', 'list', 'blockquote', 'horizontal_rule', 'table', 'link', 'image'];

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
