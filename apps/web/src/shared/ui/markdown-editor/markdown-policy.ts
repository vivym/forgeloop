import {
  validateMarkdownDocument,
  type AttachmentRef,
  type EditableObjectRef,
  type MarkdownBlockKind,
  type MarkdownValidationResult,
} from '@forgeloop/contracts';

export function validateEditorMarkdown(input: {
  markdown: string;
  objectRef: EditableObjectRef;
  allowedBlocks: MarkdownBlockKind[];
  attachments: AttachmentRef[];
  validationVersion: string;
}): MarkdownValidationResult {
  return validateMarkdownDocument({
    markdown: input.markdown,
    object_ref: input.objectRef,
    allowed_blocks: input.allowedBlocks,
    attachment_refs: input.attachments,
    validation_version: input.validationVersion,
  });
}
