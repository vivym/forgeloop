import { z } from 'zod';

import { attachmentRefSchema, type AttachmentRef } from './attachments.js';
import { editableObjectRefSchema } from './product-object-ref.js';

const nonEmpty = z.string().trim().min(1);

export const markdownBlockKindSchema = z.enum([
  'paragraph',
  'heading',
  'bold',
  'italic',
  'strikethrough',
  'list',
  'task_list',
  'blockquote',
  'code_block',
  'inline_code',
  'link',
  'table',
  'horizontal_rule',
  'image',
]);
export type MarkdownBlockKind = z.infer<typeof markdownBlockKindSchema>;

export const markdownDocumentSchema = z
  .object({
    markdown: z.string(),
    object_ref: editableObjectRefSchema,
    allowed_blocks: z.array(markdownBlockKindSchema).min(1),
    attachment_refs: z.array(attachmentRefSchema).default([]),
    validation_version: nonEmpty,
  })
  .strict();
export type MarkdownDocument = z.infer<typeof markdownDocumentSchema>;

export type MarkdownValidationIssue = {
  code:
    | 'raw_html'
    | 'unsafe_protocol'
    | 'raw_storage_url'
    | 'base64_or_blob'
    | 'unresolved_attachment'
    | 'unsupported_block';
  message: string;
};

export type MarkdownValidationResult =
  | { ok: true; markdown: string; attachment_ids: string[] }
  | { ok: false; issues: MarkdownValidationIssue[] };

const htmlPattern = /<\/?[a-z][\s\S]*?>/i;
const inlineDestinationPattern = /!?\[[^\]]*]\(\s*([^)\s]+)[^)]*\)/gi;
const referenceDefinitionPattern = /^\s{0,3}\[[^\]]+]:\s*(\S+)/gim;
const angleDestinationPattern = /<((?:https?:\/\/|javascript:|data:|file:|blob:)[^>\s]+)>/gi;
const bareUrlPattern = /(?:^|[\s(])((?:https?:\/\/|javascript:|data:|file:|blob:)[^\s<>)]+)/gim;
const rawStoragePattern = /(?:https?:\/\/[^)\s]*(?:bucket|storage|s3|signature|x-amz)[^)\s]*)|(?:storage_uri)/i;
const base64OrBlobPattern = /(?:data:|file:|blob:|base64)/i;
const unsafeProtocolPattern = /^(?:javascript:|data:|file:|blob:)/i;
const attachmentRefPattern = /attachment:\/\/([A-Za-z0-9_-]+)/g;

export function validateMarkdownDocument(input: MarkdownDocument): MarkdownValidationResult {
  const parsed = markdownDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: 'unsupported_block',
        message: issue.message,
      })),
    };
  }

  const document = parsed.data;
  const issues: MarkdownValidationIssue[] = [];

  if (htmlPattern.test(document.markdown)) {
    issues.push({ code: 'raw_html', message: 'Markdown must not contain raw HTML or MDX JSX.' });
  }

  for (const blockKind of unsupportedBlockKinds(document.markdown, new Set(document.allowed_blocks))) {
    issues.push({
      code: 'unsupported_block',
      message: `${blockKind} is not allowed by this Markdown policy.`,
    });
  }

  for (const destination of markdownDestinations(document.markdown)) {
    const normalizedDestination = normalizeDestination(destination);
    if (unsafeProtocolPattern.test(normalizedDestination)) {
      issues.push({ code: 'unsafe_protocol', message: 'Markdown links and images must use safe protocols.' });
    }
    if (base64OrBlobPattern.test(normalizedDestination)) {
      issues.push({ code: 'base64_or_blob', message: 'Markdown must not contain data, file, blob, or base64 URLs.' });
    }
    if (rawStoragePattern.test(normalizedDestination)) {
      issues.push({ code: 'raw_storage_url', message: 'Markdown must not contain raw storage URLs.' });
    }
  }

  const referencedAttachmentIds = attachmentIdsReferencedBy(document.markdown);
  const availableAttachments = new Map(document.attachment_refs.map((attachment) => [attachment.id, attachment]));
  for (const attachmentId of referencedAttachmentIds) {
    const attachment = availableAttachments.get(attachmentId);
    if (!attachment || !attachmentRefCanBeReferenced(attachment)) {
      issues.push({
        code: 'unresolved_attachment',
        message: `Attachment reference ${attachmentId} is not available for this document.`,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, markdown: document.markdown, attachment_ids: [...new Set(referencedAttachmentIds)] };
}

function markdownDestinations(markdown: string): string[] {
  const destinations: string[] = [];

  collectCaptureGroup(markdown, inlineDestinationPattern, destinations);
  collectCaptureGroup(markdown, referenceDefinitionPattern, destinations);
  collectCaptureGroup(markdown, angleDestinationPattern, destinations);
  collectCaptureGroup(markdown, bareUrlPattern, destinations);

  return destinations;
}

function collectCaptureGroup(markdown: string, pattern: RegExp, destinations: string[]): void {
  for (const match of markdown.matchAll(pattern)) {
    const destination = match[1];
    if (destination !== undefined) {
      destinations.push(destination);
    }
  }
}

function normalizeDestination(destination: string): string {
  const trimmed = destination.trim().replace(/^<|>$/g, '');
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function unsupportedBlockKinds(markdown: string, allowedBlocks: ReadonlySet<MarkdownBlockKind>): MarkdownBlockKind[] {
  const found = detectedBlockKinds(markdown);
  return [...found].filter((blockKind) => !allowedBlocks.has(blockKind));
}

function detectedBlockKinds(markdown: string): Set<MarkdownBlockKind> {
  const blockKinds = new Set<MarkdownBlockKind>();
  const lines = markdown.split(/\r?\n/);

  if (/!\[[^\]]*](?:\([^)]*\)|\[[^\]]+])/.test(markdown)) {
    blockKinds.add('image');
  }
  if (/(^|[^!])\[[^\]]+](?:\([^)]*\)|\[[^\]]+])/.test(markdown) || /<https?:\/\/[^>]+>/.test(markdown)) {
    blockKinds.add('link');
  }
  if (/^\s{0,3}#{1,6}\s+\S/m.test(markdown)) {
    blockKinds.add('heading');
  }
  if (/^\s{0,3}(?:[-+*]\s+|\d+[.)]\s+)\S/m.test(markdown)) {
    blockKinds.add('list');
  }
  if (/^\s{0,3}(?:```|~~~)/m.test(markdown)) {
    blockKinds.add('code_block');
  }
  if (/^\s{0,3}>\s?/m.test(markdown)) {
    blockKinds.add('blockquote');
  }
  if (hasTable(markdown)) {
    blockKinds.add('table');
  }
  if (lines.some((line) => isParagraphLine(line))) {
    blockKinds.add('paragraph');
  }

  return blockKinds;
}

function hasTable(markdown: string): boolean {
  const lines = markdown.split(/\r?\n/);
  return lines.some((line, index) => {
    const nextLine = lines[index + 1];
    return (
      line.includes('|') &&
      nextLine !== undefined &&
      /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(nextLine)
    );
  });
}

function isParagraphLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (/^(?:#{1,6}\s+|[-+*]\s+|\d+[.)]\s+|>\s?|```|~~~|\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$)/.test(trimmed)) {
    return false;
  }
  if (trimmed.includes('|')) {
    return false;
  }
  return true;
}

function attachmentIdsReferencedBy(markdown: string): string[] {
  const attachmentIds: string[] = [];
  for (const match of markdown.matchAll(attachmentRefPattern)) {
    const attachmentId = match[1];
    if (attachmentId !== undefined) {
      attachmentIds.push(attachmentId);
    }
  }
  return attachmentIds;
}

function attachmentRefCanBeReferenced(attachment: AttachmentRef): boolean {
  return attachment.reference_status === 'active' && attachment.safety_status === 'passed';
}
