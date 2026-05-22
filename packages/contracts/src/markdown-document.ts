import { z } from 'zod';

import { attachmentRefSchema, type AttachmentRef } from './attachments.js';
import { editableObjectRefSchema, type EditableObjectRef } from './product-object-ref.js';

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

const htmlCommentPattern = /<!--[\s\S]*?-->/;
const htmlDeclarationPattern = /<![A-Za-z][^>]*>/;
const htmlProcessingInstructionPattern = /<\?[\s\S]*?\?>/;
const mdxFragmentPattern = /<>[\s\S]*?<\/>/;
const htmlTagPattern = /<\/?[$_A-Za-z][$_A-Za-z0-9.-]*(?::[$_A-Za-z][$_A-Za-z0-9.-]*)?(?=[\s/>])[^>]*>/;
const inlineDestinationPattern = /!?\[[^\]]*]\(\s*([^)\s]+)[^)]*\)/gi;
const referenceUsePattern = /!?\[[^\]]*]\[([^\]]+)]/gi;
const referenceDefinitionPattern = /^\s{0,3}\[[^\]]+]:\s*(\S+)/gim;
const angleDestinationPattern = /<([A-Za-z][A-Za-z0-9+.-]*:[^>\s]+)>/gi;
const bareUrlPattern = /(?:^|[\s(])([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>)]+)/gim;
const bareSchemePattern = /(?:^|[\s(])([A-Za-z][A-Za-z0-9+.-]*:(?!\/\/)[^\s<>)]+)/gim;
const bareAttachmentPattern = /(?:^|[\s(])(attachment:\/\/[A-Za-z0-9_-]+(?:[/?#][^\s<>)]+)?)/gim;
const bareUrlBlockPattern = /(?:^|[\s(])(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s<>)]+/im;
const rawStorageMarkerPattern = /(?:storage_uri)|(?:^(?:s3|gs):\/\/)/i;
const base64OrBlobPattern = /^(?:data:|file:|blob:)|;base64(?:,|$)/i;
const unsafeProtocolPattern = /^(?:javascript:|data:|file:|blob:)/i;
const canonicalAttachmentDestinationPattern = /^attachment:\/\/([A-Za-z0-9_-]+)$/;
const blockDirectivePattern = /^ {0,3}::+[A-Za-z][\w-]*(?:\[[^\]\n]*])?(?:\{[^}\n]*})?(?:\s.*)?$/;
const textDirectivePattern = /(?:^|[\s([{]):[A-Za-z][\w-]*(?=$|[\s)\]},.!?;]|\[[^\]\n]*]|\{[^}\n]*})/;

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
  const activeMarkdown = stripFencedCodeBlocks(document.markdown);

  if (containsRawHtmlOrMdx(activeMarkdown)) {
    issues.push({ code: 'raw_html', message: 'Markdown must not contain raw HTML or MDX JSX.' });
  }
  if (containsMdxEsm(activeMarkdown)) {
    issues.push({ code: 'unsupported_block', message: 'Markdown must not contain MDX ESM import or export syntax.' });
  }
  if (containsMdxDirective(activeMarkdown)) {
    issues.push({ code: 'unsupported_block', message: 'Markdown must not contain MDX or custom directive syntax.' });
  }

  for (const blockKind of unsupportedBlockKinds(document.markdown, new Set(document.allowed_blocks))) {
    issues.push({
      code: 'unsupported_block',
      message: `${blockKind} is not allowed by this Markdown policy.`,
    });
  }

  const destinations = markdownDestinations(activeMarkdown);
  for (const destination of destinations) {
    const normalizedDestination = normalizeDestination(destination.value);
    if (unsafeProtocolPattern.test(normalizedDestination)) {
      issues.push({ code: 'unsafe_protocol', message: 'Markdown links and images must use safe protocols.' });
    }
    if (base64OrBlobPattern.test(normalizedDestination)) {
      issues.push({ code: 'base64_or_blob', message: 'Markdown must not contain data, file, blob, or base64 URLs.' });
    }
    if (isRawStorageDestination(normalizedDestination)) {
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
    if (!attachment || !attachmentRefCanBeReferenced(attachment, document.object_ref)) {
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
type ParsedMarkdownUrl = {
  protocol: string;
  hostname: string;
  searchParams: {
    keys(): Iterable<string>;
  };
};
type MarkdownUrlConstructor = new (input: string) => ParsedMarkdownUrl;

function stripFencedCodeBlocks(markdown: string): string {
  const lines = markdown.split(/(\r?\n)/);
  const maskedParts: string[] = [];
  let activeFence: { char: '`' | '~'; length: number } | undefined;

  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index] ?? '';
    const newline = lines[index + 1] ?? '';

    if (activeFence) {
      const closingFence = parseClosingFence(line, activeFence.char);
      maskedParts.push(newline === '' ? '' : newline);
      if (closingFence !== undefined && closingFence >= activeFence.length) {
        activeFence = undefined;
      }
      continue;
    }

    const openingFence = parseOpeningFence(line);
    if (openingFence) {
      activeFence = openingFence;
      maskedParts.push(newline === '' ? '' : newline);
      continue;
    }

    maskedParts.push(line, newline);
  }

  return maskedParts.join('');
}

function parseOpeningFence(line: string): { char: '`' | '~'; length: number } | undefined {
  const match = /^( {0,3})(`{3,}|~{3,})[^\r\n]*$/.exec(line);
  const fence = match?.[2];
  if (!fence) {
    return undefined;
  }
  const char = fence[0] as '`' | '~';
  return { char, length: fence.length };
}

function parseClosingFence(line: string, char: '`' | '~'): number | undefined {
  const escapedChar = char === '`' ? '`' : '~';
  const match = new RegExp(`^ {0,3}(${escapedChar}{3,})[\\t ]*$`).exec(line);
  const fence = match?.[1];
  return fence?.length;
}

function containsRawHtmlOrMdx(markdown: string): boolean {
  return (
    htmlCommentPattern.test(markdown) ||
    htmlDeclarationPattern.test(markdown) ||
    htmlProcessingInstructionPattern.test(markdown) ||
    mdxFragmentPattern.test(markdown) ||
    htmlTagPattern.test(markdown) ||
    containsMdxExpression(markdown)
  );
}

function containsMdxExpression(markdown: string): boolean {
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== '{') {
      continue;
    }

    const endIndex = balancedBraceEnd(markdown, index);
    if (endIndex !== undefined && markdown.slice(index + 1, endIndex).trim().length > 0) {
      return true;
    }
  }

  return false;
}

function balancedBraceEnd(markdown: string, startIndex: number): number | undefined {
  let depth = 0;
  for (let index = startIndex; index < markdown.length; index += 1) {
    const character = markdown[index];
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return undefined;
}

function containsMdxEsm(markdown: string): boolean {
  for (const line of markdown.split(/\r?\n/)) {
    const blockLine = blockLevelContent(line);
    if (!blockLine) {
      continue;
    }
    if (isMdxImportLine(blockLine) || isMdxExportLine(blockLine)) {
      return true;
    }
  }

  return false;
}

function containsMdxDirective(markdown: string): boolean {
  for (const line of markdown.split(/\r?\n/)) {
    if (blockDirectivePattern.test(line) || textDirectivePattern.test(line)) {
      return true;
    }
  }

  return false;
}

function blockLevelContent(line: string): string | undefined {
  const match = /^( {0,3})(\S.*)$/.exec(line);
  return match?.[2];
}

function isMdxImportLine(line: string): boolean {
  if (!/^import\b/.test(line)) {
    return false;
  }
  const afterImport = line.replace(/^import\b/, '').trimStart();
  const afterTrivia = stripLeadingJsBlockComments(afterImport).trimStart();
  if (afterTrivia === '') {
    return true;
  }
  const afterType = afterTrivia.startsWith('type ')
    ? stripLeadingJsBlockComments(afterTrivia.slice('type'.length).trimStart()).trimStart()
    : afterTrivia;
  return /^([\w{]|\*\s+as\b|["'])/.test(afterType);
}

function isMdxExportLine(line: string): boolean {
  if (!/^export\b/.test(line)) {
    return false;
  }
  const afterExport = line.replace(/^export\b/, '').trimStart();
  const afterTrivia = stripLeadingJsBlockComments(afterExport).trimStart();
  return (
    afterTrivia === '' ||
    /^(default\b|const\b|let\b|var\b|function\b|class\b|async\s+function\b|type\b|interface\b|enum\b|abstract\s+class\b|declare\b|\{|\*)/.test(
      afterTrivia,
    )
  );
}

function stripLeadingJsBlockComments(value: string): string {
  let remainder = value;
  let match = /^\/\*[^]*?\*\//.exec(remainder);
  while (match) {
    remainder = remainder.slice(match[0].length).trimStart();
    match = /^\/\*[^]*?\*\//.exec(remainder);
  }
  return remainder;
}

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
  collectCaptureGroup(markdown, bareSchemePattern, destinations, 'link');
  collectCaptureGroup(markdown, bareAttachmentPattern, destinations, 'link');

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
  if (!destination.startsWith('/') || destination.startsWith('//') || destination.includes('?') || destination.includes('#')) {
    return false;
  }

  const segments = destination.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return false;
  }

  return productRouteSegmentsAllowed(segments);
}

function isSafeHttpsExternalLink(destination: string): boolean {
  return /^https:\/\/[^\s/$.?#].[^\s]*$/i.test(destination) && !isRawStorageDestination(destination);
}

function isRawStorageDestination(destination: string): boolean {
  if (rawStorageMarkerPattern.test(destination)) {
    return true;
  }

  const URLConstructor = markdownUrlConstructor();
  if (!URLConstructor) {
    return false;
  }

  try {
    const url = new URLConstructor(destination);
    const protocol = url.protocol.toLowerCase();
    if (protocol === 's3:' || protocol === 'gs:') {
      return true;
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
      return false;
    }

    return isRawStorageHost(url.hostname) || hasSignedStorageQuery(url);
  } catch {
    return false;
  }
}

function isRawStorageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const labels = host.split('.');
  return (
    labels.includes('bucket') ||
    labels.includes('storage') ||
    host === 's3.amazonaws.com' ||
    host.endsWith('.s3.amazonaws.com') ||
    /\.s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(host) ||
    host === 'storage.googleapis.com' ||
    host.endsWith('.storage.googleapis.com') ||
    host.endsWith('.blob.core.windows.net') ||
    host.endsWith('.digitaloceanspaces.com') ||
    host.endsWith('.r2.cloudflarestorage.com')
  );
}

function markdownUrlConstructor(): MarkdownUrlConstructor | undefined {
  return (globalThis as { URL?: MarkdownUrlConstructor }).URL;
}

function hasSignedStorageQuery(url: ParsedMarkdownUrl): boolean {
  for (const key of url.searchParams.keys()) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === 'token' ||
      normalizedKey === 'signature' ||
      normalizedKey === 'expires' ||
      normalizedKey.includes('signature') ||
      normalizedKey.startsWith('x-amz-') ||
      normalizedKey.startsWith('x-goog-')
    ) {
      return true;
    }
  }
  return false;
}

function productRouteSegmentsAllowed(segments: string[]): boolean {
  const [root, second, third, fourth] = segments;

  switch (root) {
    case 'dashboard':
    case 'my-work':
    case 'board':
    case 'specs-plans':
      return segments.length === 1;
    case 'requirements':
      return segmentedObjectRouteAllowed(segments, { allowNew: true, childRoutes: ['spec', 'plan', 'evidence'] });
    case 'initiatives':
    case 'tech-debt':
    case 'bugs':
      return segmentedObjectRouteAllowed(segments, { allowNew: true, childRoutes: ['evidence'] });
    case 'tasks':
      if (segments.length === 1) {
        return true;
      }
      if (segments.length === 2) {
        return second === 'new' || isDynamicIdSegment(second);
      }
      return segments.length === 4 && isDynamicIdSegment(second) && ['packages', 'runs', 'reviews'].includes(third ?? '') && isDynamicIdSegment(fourth);
    case 'releases':
      return segments.length === 1 || (isDynamicIdSegment(second) && (segments.length === 2 || (segments.length === 3 && third === 'evidence')));
    case 'specs':
    case 'plans':
      return (
        (segments.length === 2 && isDynamicIdSegment(second)) ||
        (segments.length === 4 && isDynamicIdSegment(second) && third === 'revisions' && isDynamicIdSegment(fourth))
      );
    case 'reports':
      return segments.length === 1 || (segments.length === 2 && ['delivery', 'quality', 'release-readiness', 'observation', 'replay'].includes(second ?? ''));
    default:
      return false;
  }
}

function segmentedObjectRouteAllowed(
  segments: string[],
  options: { allowNew: boolean; childRoutes: readonly string[] },
): boolean {
  const [, idOrNew, childRoute] = segments;
  if (segments.length === 1) {
    return true;
  }
  if (segments.length === 2) {
    return (options.allowNew && idOrNew === 'new') || isDynamicIdSegment(idOrNew);
  }
  return segments.length === 3 && isDynamicIdSegment(idOrNew) && options.childRoutes.includes(childRoute ?? '');
}

function isDynamicIdSegment(segment: string | undefined): segment is string {
  return segment !== undefined && segment.length > 0 && segment !== 'new';
}

function unsupportedBlockKinds(markdown: string, allowedBlocks: ReadonlySet<MarkdownBlockKind>): DetectedMarkdownKind[] {
  const found = detectedBlockKinds(markdown);
  return [...found].filter((blockKind) => blockKind === 'unsupported_heading_level' || !allowedBlocks.has(blockKind));
}

function detectedBlockKinds(markdown: string): Set<DetectedMarkdownKind> {
  const blockKinds = new Set<DetectedMarkdownKind>();
  const activeMarkdown = stripFencedCodeBlocks(markdown);
  const lines = activeMarkdown.split(/\r?\n/);

  if (/!\[[^\]]*](?:\([^)]*\)|\[[^\]]+])/.test(activeMarkdown)) {
    blockKinds.add('image');
  }
  if (
    /(^|[^!])\[[^\]]+](?:\([^)]*\)|\[[^\]]+])/.test(activeMarkdown) ||
    /<https?:\/\/[^>]+>/.test(activeMarkdown) ||
    bareUrlBlockPattern.test(activeMarkdown)
  ) {
    blockKinds.add('link');
  }
  if (
    /(^|[^*_])\*\*[^*\n]+\*\*([^*_]|$)/.test(activeMarkdown) ||
    /(^|[^_])__[^_\n]+__([^_]|$)/.test(activeMarkdown)
  ) {
    blockKinds.add('bold');
  }
  if (/(^|[^*_])\*[^*\n]+\*([^*_]|$)/.test(activeMarkdown) || /(^|[^_])_[^_\n]+_([^_]|$)/.test(activeMarkdown)) {
    blockKinds.add('italic');
  }
  if (/~~[^~\n]+~~/.test(activeMarkdown)) {
    blockKinds.add('strikethrough');
  }
  if (/(^|[^`])`[^`\n]+`([^`]|$)/.test(activeMarkdown)) {
    blockKinds.add('inline_code');
  }
  if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/m.test(activeMarkdown)) {
    blockKinds.add('horizontal_rule');
  }
  if (/^\s{0,3}#{1,4}\s+\S/m.test(activeMarkdown)) {
    blockKinds.add('heading');
  }
  if (/^\s{0,3}#{5,6}\s+\S/m.test(activeMarkdown)) {
    blockKinds.add('unsupported_heading_level');
  }
  if (/^\s{0,3}[-+*]\s+\[[ xX]\]\s+\S/m.test(activeMarkdown)) {
    blockKinds.add('task_list');
  }
  if (/^\s{0,3}(?:[-+*]\s+|\d+[.)]\s+)\S/m.test(activeMarkdown)) {
    blockKinds.add('list');
  }
  if (/^\s{0,3}(?:```|~~~)/m.test(markdown)) {
    blockKinds.add('code_block');
  }
  if (/^\s{0,3}>\s?/m.test(activeMarkdown)) {
    blockKinds.add('blockquote');
  }
  if (hasTable(activeMarkdown)) {
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

function attachmentRefCanBeReferenced(attachment: AttachmentRef, documentObjectRef: EditableObjectRef): boolean {
  return (
    attachment.reference_status === 'active' &&
    attachment.safety_status === 'passed' &&
    attachmentIsScopedToDocumentObject(attachment, documentObjectRef)
  );
}

function attachmentIsScopedToDocumentObject(attachment: AttachmentRef, documentObjectRef: EditableObjectRef): boolean {
  if (attachment.owner_object_type === documentObjectRef.type && attachment.owner_object_id === documentObjectRef.id) {
    return true;
  }

  return attachment.linked_object_refs.some((linkedRef) => linkedRef.type === documentObjectRef.type && linkedRef.id === documentObjectRef.id);
}
