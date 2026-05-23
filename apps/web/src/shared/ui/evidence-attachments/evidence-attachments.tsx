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
  return (
    <div className="grid gap-3">
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
      <figure className="rounded-md border border-border bg-surface p-3">
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
    <section className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-primary">{attachment.filename}</p>
        <p className="text-xs text-text-muted">{attachment.content_type}</p>
      </div>
      <a className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary" href={renderState.renderRef.render_url}>
        {`Open ${attachment.filename}`}
      </a>
      <a
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary"
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
    <section className="rounded-md border border-border bg-surface-muted p-3 text-sm text-text-secondary">
      <p className="font-semibold text-text-primary">{filename}</p>
      <p>{loading ? 'Loading evidence' : 'Unavailable evidence'}</p>
    </section>
  );
}

function attachmentCanRender(attachment: AttachmentRef) {
  return attachment.reference_status === 'active' && attachment.safety_status === 'passed';
}

const defaultCreateRenderUrl: NonNullable<EvidenceAttachmentsProps['createRenderUrl']> = (attachmentId, body) =>
  createForgeloopAttachmentApi().createRenderUrl(attachmentId, body);
