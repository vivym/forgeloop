import { useEffect, useState, type ReactNode } from 'react';
import type { AttachmentRef, EditableObjectRef, MarkdownBlockKind, MarkdownDocument } from '@forgeloop/contracts';

import { DetailLayout, MetadataGrid, PageHeader, Section } from '../../shared/layout';
import { EvidenceAttachments, ForgeMarkdownEditor, InlineNotice, StatusPill } from '../../shared/ui';

export interface ProjectObjectDetail {
  id: string;
  ref: EditableObjectRef;
  title: string;
  status: string;
  priority?: string | undefined;
  risk?: string | undefined;
  driver_actor_id?: string | undefined;
  narrative_markdown: string;
  attachment_refs?: AttachmentRef[] | undefined;
}

export interface ObjectDetailLayoutProps<T extends ProjectObjectDetail> {
  detail: T | undefined;
  error?: Error | null;
  isLoading: boolean;
  objectLabel: string;
  onSaveNarrative?: ((document: MarkdownDocument) => Promise<void> | void) | undefined;
  renderSections?: (detail: T) => ReactNode;
}

const allowedNarrativeBlocks: MarkdownBlockKind[] = ['paragraph', 'heading', 'list', 'blockquote', 'horizontal_rule', 'table', 'link', 'image'];

export function ObjectDetailLayout<T extends ProjectObjectDetail>({
  detail,
  error,
  isLoading,
  objectLabel,
  onSaveNarrative,
  renderSections,
}: ObjectDetailLayoutProps<T>) {
  const [markdown, setMarkdown] = useState(detail?.narrative_markdown ?? '');

  useEffect(() => {
    setMarkdown(detail?.narrative_markdown ?? '');
  }, [detail?.id, detail?.narrative_markdown]);

  if (isLoading) {
    return (
      <DetailLayout header={<PageHeader subtitle={`Loading ${objectLabel.toLowerCase()} context.`} title={objectLabel} />}>
        <InlineNotice title={`${objectLabel} is loading.`} tone="info" />
      </DetailLayout>
    );
  }

  if (error || detail === undefined) {
    return (
      <DetailLayout header={<PageHeader subtitle={`${objectLabel} detail could not be loaded.`} title={objectLabel} />}>
        <InlineNotice title={`${objectLabel} was not found.`} tone="warning" />
      </DetailLayout>
    );
  }

  return (
    <DetailLayout
      header={
        <PageHeader
          subtitle={`${objectLabel} ${detail.ref.id}`}
          title={objectLabel}
        />
      }
      actionRail={
        <Section title="Metadata">
          <MetadataGrid
            items={[
              { label: 'Type', value: objectLabel },
              { label: 'Lifecycle', value: <StatusPill tone="neutral">{detail.status}</StatusPill> },
              { label: 'Risk', value: detail.risk ?? 'Unscored' },
              { label: 'Driver', value: detail.driver_actor_id ?? 'Unassigned' },
            ]}
          />
        </Section>
      }
    >
      <Section title={detail.title}>
        <div className="grid gap-4">
          <ForgeMarkdownEditor
            allowedBlocks={allowedNarrativeBlocks}
            attachments={detail.attachment_refs ?? []}
            mode="edit"
            objectRef={detail.ref}
            onChange={setMarkdown}
            onUploadAttachment={() => Promise.reject(new Error('Attachment uploads are not enabled on this route yet.'))}
            validationPolicy={{ validation_version: '2026-05-23' }}
            value={markdown}
            {...(onSaveNarrative === undefined ? {} : { onSave: onSaveNarrative })}
          />
        </div>
      </Section>
      {renderSections?.(detail)}
      <Section title="Evidence attachments">
        {detail.attachment_refs?.length ? (
          <EvidenceAttachments attachments={detail.attachment_refs} />
        ) : (
          <p className="text-sm text-text-secondary">No evidence attachments linked.</p>
        )}
      </Section>
    </DetailLayout>
  );
}
