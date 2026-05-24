import { useEffect, useState } from 'react';
import { attachmentRenderRefSchema, type AttachmentRef, type AttachmentRenderRef } from '@forgeloop/contracts';

import { createForgeloopAttachmentApi } from '../../api/attachments';

export interface EvidenceAttachmentsProps {
  attachments: AttachmentRef[];
  createRenderUrl?: (attachmentId: string, body: { disposition: 'inline' | 'download' }) => Promise<AttachmentRenderRef>;
}

type RenderState =
  | { state: 'loading' }
  | { state: 'available'; renderRef: AttachmentRenderRef }
  | { state: 'unavailable' };

export function EvidenceAttachments({ attachments, createRenderUrl = defaultCreateRenderUrl }: EvidenceAttachmentsProps) {
  if (attachments.length === 0) {
    return (
      <section aria-label="Evidence attachments" className="rounded-md border border-border bg-surface-muted p-3 text-sm text-text-secondary">
        No evidence attachments.
      </section>
    );
  }

  return (
    <div aria-label="Evidence attachments" className="grid gap-3" role="list">
      {attachments.map((attachment) => (
        <EvidenceAttachmentCard attachment={attachment} createRenderUrl={createRenderUrl} key={attachment.id} />
      ))}
    </div>
  );
}

function EvidenceAttachmentCard({
  attachment,
  createRenderUrl,
}: {
  attachment: AttachmentRef;
  createRenderUrl: NonNullable<EvidenceAttachmentsProps['createRenderUrl']>;
}) {
  const [renderState, setRenderState] = useState<RenderState>(() =>
    attachmentCanRender(attachment) ? { state: 'loading' } : { state: 'unavailable' },
  );
  const disposition = attachment.content_type.startsWith('image/') ? 'inline' : 'download';

  useEffect(() => {
    let cancelled = false;
    if (!attachmentCanRender(attachment)) {
      setRenderState({ state: 'unavailable' });
      return;
    }

    setRenderState({ state: 'loading' });
    createRenderUrl(attachment.id, { disposition })
      .then((renderRef) => {
        const parsed = attachmentRenderRefSchema.safeParse(renderRef);
        if (!cancelled) {
          setRenderState(
            parsed.success && parsed.data.attachment_id === attachment.id
              ? { state: 'available', renderRef: parsed.data }
              : { state: 'unavailable' },
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRenderState({ state: 'unavailable' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attachment, createRenderUrl, disposition]);

  if (renderState.state !== 'available') {
    return <UnavailableEvidence filename={attachment.filename} loading={renderState.state === 'loading'} />;
  }

  if (attachment.content_type.startsWith('image/')) {
    return (
      <figure aria-label={`Evidence attachment ${attachment.filename}`} className="rounded-md border border-border bg-surface p-3" role="listitem">
        <img
          alt={attachment.alt_text ?? attachment.caption ?? attachment.filename}
          className="max-h-96 rounded border border-border object-contain"
          src={renderState.renderRef.render_url}
        />
        <figcaption className="mt-2 text-sm text-text-secondary">{attachment.caption ?? attachment.filename}</figcaption>
      </figure>
    );
  }

  return (
    <section
      aria-label={`Evidence attachment ${attachment.filename}`}
      className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-3"
      role="listitem"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-primary">{attachment.filename}</p>
        <p className="text-xs text-text-muted">{attachment.content_type}</p>
      </div>
      <a className={attachmentActionClass} href={renderState.renderRef.render_url}>
        {`Open ${attachment.filename}`}
      </a>
      <a
        className={attachmentActionClass}
        download={attachment.filename}
        href={renderState.renderRef.render_url}
      >
        {`Download ${attachment.filename}`}
      </a>
    </section>
  );
}

function UnavailableEvidence({ filename, loading }: { filename: string; loading: boolean }) {
  return (
    <section
      aria-busy={loading}
      aria-label={`Evidence attachment ${filename}`}
      className="rounded-md border border-border bg-surface-muted p-3 text-sm text-text-secondary"
      role="listitem"
    >
      <p className="font-semibold text-text-primary">{filename}</p>
      <p>{loading ? 'Loading evidence' : 'Unavailable evidence'}</p>
    </section>
  );
}

const attachmentActionClass =
  'rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

function attachmentCanRender(attachment: AttachmentRef) {
  return attachment.reference_status === 'active' && attachment.safety_status === 'passed';
}

const defaultCreateRenderUrl: NonNullable<EvidenceAttachmentsProps['createRenderUrl']> = (attachmentId, body) =>
  createForgeloopAttachmentApi().createRenderUrl(attachmentId, body);
