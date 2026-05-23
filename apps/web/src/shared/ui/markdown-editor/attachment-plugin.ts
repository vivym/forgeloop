import type { AttachmentRef } from '@forgeloop/contracts';

export function attachmentMarkdownFor(attachment: AttachmentRef): string {
  const safeName = attachment.filename.replace(/[\]\n\r]/g, ' ').trim() || attachment.id;
  const target = `attachment://${attachment.id}`;

  if (attachment.content_type.startsWith('image/')) {
    const alt = (attachment.alt_text ?? attachment.caption ?? safeName).replace(/[\]\n\r]/g, ' ').trim() || safeName;
    return `![${alt}](${target})`;
  }

  return `[${safeName}](${target})`;
}
