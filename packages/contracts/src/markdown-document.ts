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

const allowedProductRoutePatterns = [
  /^\/dashboard$/,
  /^\/my-work$/,
  /^\/requirements(?:\/new|\/[^/?#]+(?:\/(?:spec|plan|evidence))?)?$/,
  /^\/initiatives(?:\/new|\/[^/?#]+(?:\/evidence)?)?$/,
  /^\/tech-debt(?:\/new|\/[^/?#]+(?:\/evidence)?)?$/,
  /^\/tasks(?:\/new|\/[^/?#]+(?:\/packages\/[^/?#]+|\/runs\/[^/?#]+|\/reviews\/[^/?#]+)?)?$/,
  /^\/bugs(?:\/new|\/[^/?#]+(?:\/evidence)?)?$/,
  /^\/releases(?:\/[^/?#]+(?:\/evidence)?)?$/,
  /^\/specs-plans$/,
  /^\/specs\/[^/?#]+(?:\/revisions\/[^/?#]+)?$/,
  /^\/plans\/[^/?#]+(?:\/revisions\/[^/?#]+)?$/,
  /^\/board$/,
  /^\/reports(?:\/(?:delivery|quality|release-readiness|observation|replay))?$/,
  /^\/dev-tools$/,
] as const;

const htmlPattern = /<\/?[a-z][\s\S]*?>/i;
const inlineDestinationPattern = /!?\[[^\]]*]\(\s*([^)\s]+)[^)]*\)/gi;
const referenceUsePattern = /!?\[[^\]]*]\[([^\]]+)]/gi;
const referenceDefinitionPattern = /^\s{0,3}\[[^\]]+]:\s*(\S+)/gim;
const angleDestinationPattern = /<((?:https?:\/\/|javascript:|data:|file:|blob:|s3:|gs:)[^>\s]+)>/gi;
const bareUrlPattern = /(?:^|[\s(])((?:https?:\/\/|javascript:|data:|file:|blob:|s3:\/\/|gs:\/\/)[^\s<>)]+)/gim;
const bareUrlBlockPattern = /(?:^|[\s(])(?:https?:\/\/|javascript:|data:|file:|blob:|s3:\/\/|gs:\/\/)[^\s<>)]+/im;
const rawStoragePattern =
  /(?:https?:\/\/[^)\s]*(?:bucket|storage|s3|signature|x-amz)[^)\s]*)|(?:storage_uri)|(?:^(?:s3|gs):\/\/)/i;
const base64OrBlobPattern = /(?:data:|file:|blob:|base64)/i;
const unsafeProtocolPattern = /^(?:javascript:|data:|file:|blob:)/i;
const canonicalAttachmentDestinationPattern = /^attachment:\/\/([A-Za-z0-9_-]+)$/;

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

  const destinations = markdownDestinations(document.markdown);
  for (const destination of destinations) {
    const normalizedDestination = normalizeDestination(destination.value);
    if (unsafeProtocolPattern.test(normalizedDestination)) {
      issues.push({ code: 'unsafe_protocol', message: 'Markdown links and images must use safe protocols.' });
    }
    if (base64OrBlobPattern.test(normalizedDestination)) {
      issues.push({ code: 'base64_or_blob', message: 'Markdown must not contain data, file, blob, or base64 URLs.' });
    }
    if (rawStoragePattern.test(normalizedDestination)) {
      issues.push({ code: 'raw_storage_url', message: 'Markdown must not contain raw storage URLs.' });
    }
    if (normalizedDestination.startsWith('attachment://') && !canonicalAttachmentDestinationPattern.test(normalizedDestination)) {
      issues.push({ code: 'unsafe_protocol', message: 'Attachment destinations must be canonical attachment://<id> refs.' });
    }
    if (destination.kind === 'image' && !canonicalAttachmentDestinationPattern.test(normalizedDestination)) {
      issues.push({ code: 'unsafe_protocol', message: 'Markdown images must use canonical attachment://<id> refs.' });
    }
    if (destination.kind !== 'image' && !linkDestinationAllowed(normalizedDestination)) {
      issues.push({ code: 'unsafe_protocol', message: 'Markdown links must use allowed product, https, or attachment destinations.' });
    }
  }

  const referencedAttachmentIds = attachmentIdsReferencedBy(destinations);
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

type MarkdownDestination = {
  kind: 'image' | 'link' | 'bare';
  value: string;
};
type DetectedMarkdownKind = MarkdownBlockKind | 'unsupported_heading_level';

function markdownDestinations(markdown: string): MarkdownDestination[] {
  const destinations: MarkdownDestination[] = [];
  const referenceDefinitions = referenceDefinitionsByLabel(markdown);

  for (const match of markdown.matchAll(inlineDestinationPattern)) {
    const value = match[1];
    if (value !== undefined) {
      destinations.push({ kind: match[0].startsWith('!') ? 'image' : 'link', value });
    }
  }
  for (const match of markdown.matchAll(referenceUsePattern)) {
    const label = match[1];
    const value = label === undefined ? undefined : referenceDefinitions.get(normalizeReferenceLabel(label));
    if (value !== undefined) {
      destinations.push({ kind: match[0].startsWith('!') ? 'image' : 'link', value });
    }
  }
  for (const value of referenceDefinitions.values()) {
    destinations.push({ kind: 'link', value });
  }
  collectCaptureGroup(markdown, angleDestinationPattern, destinations, 'link');
  collectCaptureGroup(markdown, bareUrlPattern, destinations, 'link');

  return destinations;
}

function referenceDefinitionsByLabel(markdown: string): Map<string, string> {
  const definitions = new Map<string, string>();
  for (const match of markdown.matchAll(referenceDefinitionPattern)) {
    const labelMatch = /^\s{0,3}\[([^\]]+)]:/.exec(match[0]);
    const label = labelMatch?.[1];
    const destination = match[1];
    if (label !== undefined && destination !== undefined) {
      definitions.set(normalizeReferenceLabel(label), destination);
    }
  }
  return definitions;
}

function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function collectCaptureGroup(
  markdown: string,
  pattern: RegExp,
  destinations: MarkdownDestination[],
  kind: MarkdownDestination['kind'],
): void {
  for (const match of markdown.matchAll(pattern)) {
    const destination = match[1];
    if (destination !== undefined) {
      destinations.push({ kind, value: destination });
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

function linkDestinationAllowed(destination: string): boolean {
  if (canonicalAttachmentDestinationPattern.test(destination)) {
    return true;
  }
  if (isSafeProductRoute(destination)) {
    return true;
  }
  return isSafeHttpsExternalLink(destination);
}

function isSafeProductRoute(destination: string): boolean {
  return (
    destination.startsWith('/') &&
    !destination.startsWith('//') &&
    !destination.includes('?') &&
    !destination.includes('#') &&
    allowedProductRoutePatterns.some((pattern) => pattern.test(destination))
  );
}

function isSafeHttpsExternalLink(destination: string): boolean {
  return /^https:\/\/[^\s/$.?#].[^\s]*$/i.test(destination) && !rawStoragePattern.test(destination);
}

function unsupportedBlockKinds(markdown: string, allowedBlocks: ReadonlySet<MarkdownBlockKind>): DetectedMarkdownKind[] {
  const found = detectedBlockKinds(markdown);
  return [...found].filter((blockKind) => blockKind === 'unsupported_heading_level' || !allowedBlocks.has(blockKind));
}

function detectedBlockKinds(markdown: string): Set<DetectedMarkdownKind> {
  const blockKinds = new Set<DetectedMarkdownKind>();
  const lines = markdown.split(/\r?\n/);

  if (/!\[[^\]]*](?:\([^)]*\)|\[[^\]]+])/.test(markdown)) {
    blockKinds.add('image');
  }
  if (
    /(^|[^!])\[[^\]]+](?:\([^)]*\)|\[[^\]]+])/.test(markdown) ||
    /<https?:\/\/[^>]+>/.test(markdown) ||
    bareUrlBlockPattern.test(markdown)
  ) {
    blockKinds.add('link');
  }
  if (/(^|[^*_])\*\*[^*\n]+\*\*([^*_]|$)/.test(markdown) || /(^|[^_])__[^_\n]+__([^_]|$)/.test(markdown)) {
    blockKinds.add('bold');
  }
  if (/(^|[^*_])\*[^*\n]+\*([^*_]|$)/.test(markdown) || /(^|[^_])_[^_\n]+_([^_]|$)/.test(markdown)) {
    blockKinds.add('italic');
  }
  if (/~~[^~\n]+~~/.test(markdown)) {
    blockKinds.add('strikethrough');
  }
  if (/(^|[^`])`[^`\n]+`([^`]|$)/.test(markdown)) {
    blockKinds.add('inline_code');
  }
  if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/m.test(markdown)) {
    blockKinds.add('horizontal_rule');
  }
  if (/^\s{0,3}#{1,4}\s+\S/m.test(markdown)) {
    blockKinds.add('heading');
  }
  if (/^\s{0,3}#{5,6}\s+\S/m.test(markdown)) {
    blockKinds.add('unsupported_heading_level');
  }
  if (/^\s{0,3}[-+*]\s+\[[ xX]\]\s+\S/m.test(markdown)) {
    blockKinds.add('task_list');
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
  if (
    /^(?:#{1,6}\s+|[-+*]\s+|\d+[.)]\s+|>\s?|```|~~~|\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$)/.test(trimmed)
  ) {
    return false;
  }
  if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
    return false;
  }
  if (trimmed.includes('|')) {
    return false;
  }
  return true;
}

function attachmentIdsReferencedBy(destinations: MarkdownDestination[]): string[] {
  const attachmentIds: string[] = [];
  for (const destination of destinations) {
    const match = canonicalAttachmentDestinationPattern.exec(normalizeDestination(destination.value));
    if (match?.[1] !== undefined) {
      attachmentIds.push(match[1]);
    }
  }
  return attachmentIds;
}

function attachmentRefCanBeReferenced(attachment: AttachmentRef): boolean {
  return attachment.reference_status === 'active' && attachment.safety_status === 'passed';
}
