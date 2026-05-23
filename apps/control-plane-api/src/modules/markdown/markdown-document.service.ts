import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  markdownDocumentSchema,
  validateMarkdownDocument,
  type AttachmentRef,
  type EditableObjectRef,
  type MarkdownDocument,
} from '@forgeloop/contracts';

import { AttachmentsService } from '../attachments/attachments.service';

const attachmentReferencePattern = /attachment:\/\/([A-Za-z0-9_-]+)/g;

@Injectable()
export class MarkdownDocumentService {
  constructor(@Inject(AttachmentsService) private readonly attachmentsService: AttachmentsService) {}

  async validateForWrite(document: MarkdownDocument): Promise<MarkdownDocument> {
    const parsed = markdownDocumentSchema.safeParse(document);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Markdown document validation failed', issues: parsed.error.issues });
    }

    const resolvedAttachmentRefs = await this.resolveAttachmentRefs(parsed.data.markdown, parsed.data.object_ref);
    const validation = validateMarkdownDocument({
      ...parsed.data,
      allowed_blocks: allowedBlocksForServerValidation(parsed.data.markdown, parsed.data.allowed_blocks),
      attachment_refs: resolvedAttachmentRefs,
    });
    if (!validation.ok) {
      throw new BadRequestException({
        message: 'Markdown document validation failed',
        issues: validation.issues,
      });
    }

    return {
      ...parsed.data,
      markdown: validation.markdown,
      attachment_refs: resolvedAttachmentRefs,
    };
  }

  private async resolveAttachmentRefs(markdown: string, objectRef: EditableObjectRef): Promise<AttachmentRef[]> {
    const attachmentIds = [...new Set([...markdown.matchAll(attachmentReferencePattern)].map((match) => match[1]).filter(isString))];
    const attachmentRefs: AttachmentRef[] = [];

    for (const attachmentId of attachmentIds) {
      const attachment = await this.attachmentsService.getReferenceableAttachment(attachmentId, objectRef);
      if (attachment !== undefined) {
        attachmentRefs.push(attachment);
      }
    }

    return attachmentRefs;
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function allowedBlocksForServerValidation(markdown: string, allowedBlocks: MarkdownDocument['allowed_blocks']): MarkdownDocument['allowed_blocks'] {
  if (!allowedBlocks.includes('image') || allowedBlocks.includes('link') || containsExplicitNonImageLink(markdown)) {
    return allowedBlocks;
  }

  return [...allowedBlocks, 'link'];
}

function containsExplicitNonImageLink(markdown: string): boolean {
  return /(^|[^!])\[[^\]]+]\([^)]*\)/.test(markdown) || /<https?:\/\/[^>]+>/.test(markdown) || /(^|[\s(])https?:\/\/[^\s<>)]+/.test(markdown);
}
