import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BadRequestException, ForbiddenException, GoneException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  attachmentPatchSchema,
  attachmentRefSchema,
  attachmentUploadMetadataSchema,
  objectRefSchema,
  type AttachmentPatch,
  type AttachmentRef,
  type AttachmentRenderRef,
  type AttachmentUploadMetadata,
  type ObjectRef,
} from '@forgeloop/contracts';
import type { DeliveryRepository } from '@forgeloop/db';
import type { Attachment } from '@forgeloop/domain';

import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';

type UploadedAttachmentFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer?: Buffer;
};

type RenderDisposition = 'inline' | 'download';

type RenderTokenRecord = {
  attachmentId: string;
  token: string;
  expiresAt: string;
  disposition: RenderDisposition;
};

type RenderResponse = {
  status(statusCode: number): RenderResponse;
  setHeader(name: string, value: string): void;
  send(body: Buffer | Record<string, unknown>): void;
};

const contentTypeByExtension = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.txt', 'text/plain'],
  ['.log', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.json', 'application/json'],
  ['.pdf', 'application/pdf'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
]);

const categorySizeLimitBytes: Record<AttachmentUploadMetadata['evidence_category'], number> = {
  image: 10 * 1024 * 1024,
  log: 5 * 1024 * 1024,
  recording: 100 * 1024 * 1024,
  document: 25 * 1024 * 1024,
  generated_artifact: 25 * 1024 * 1024,
};

const attachmentOwnerTypes = new Set<AttachmentUploadMetadata['object_type']>([
  'initiative',
  'requirement',
  'tech_debt',
  'spec',
  'plan',
  'task',
  'bug',
  'release',
]);

const attachmentRefObjectTypes = new Set<ObjectRef['type']>([
  'initiative',
  'requirement',
  'bug',
  'tech_debt',
  'task',
  'spec',
  'plan',
  'release',
]);

@Injectable()
export class AttachmentsService {
  private readonly renderTokens = new Map<string, RenderTokenRecord>();
  private readonly storageRoot = process.env.FORGELOOP_ATTACHMENT_STORAGE_ROOT?.trim() || join(process.cwd(), '.forgeloop', 'attachments');

  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(ControlPlaneRuntimeService) private readonly runtime: ControlPlaneRuntimeService,
  ) {}

  async upload(file: UploadedAttachmentFile | undefined, metadataJson: unknown): Promise<AttachmentRef> {
    if (file === undefined) {
      throw new BadRequestException('Attachment uploads must use multipart/form-data with a file part named file');
    }
    if (typeof metadataJson !== 'string' || metadataJson.trim().length === 0) {
      throw new BadRequestException('Attachment uploads require a metadata multipart field');
    }

    const metadata = this.parseUploadMetadata(metadataJson);
    await this.assertObjectReadable(metadata.object_type, metadata.object_id);
    this.validateFile(file, metadata.evidence_category);

    const bytes = file.buffer;
    if (bytes === undefined || bytes.length === 0) {
      throw new BadRequestException('Attachment file cannot be empty');
    }

    const id = this.runtime.id('attachment');
    const storageUri = `local://attachments/${id}`;
    const at = this.runtime.now();
    const attachment: Attachment = {
      id,
      owner_object_type: metadata.object_type,
      owner_object_id: metadata.object_id,
      linked_object_refs: [],
      filename: file.originalname,
      content_type: file.mimetype,
      size_bytes: bytes.length,
      storage_uri: storageUri,
      checksum_sha256: createHash('sha256').update(bytes).digest('hex'),
      uploaded_by_actor_id: 'actor-product',
      created_at: at,
      evidence_category: metadata.evidence_category,
      ...(metadata.caption !== undefined ? { caption: metadata.caption } : {}),
      ...(metadata.alt_text !== undefined ? { alt_text: metadata.alt_text } : {}),
      visibility: metadata.visibility,
      safety_status: 'passed',
      reference_status: 'active',
    };

    await this.writeAttachmentBinary(storageUri, bytes);
    await this.repository.saveAttachment(attachment);
    return this.toPublicRef(attachment);
  }

  async createRenderUrl(attachmentId: string, disposition: RenderDisposition = 'inline'): Promise<AttachmentRenderRef> {
    if (disposition !== 'inline' && disposition !== 'download') {
      throw new BadRequestException('Attachment render disposition must be inline or download');
    }

    const attachment = await this.requireAttachment(attachmentId);
    await this.assertAttachmentRenderable(attachment);
    await this.assertObjectReadable(attachment.owner_object_type, attachment.owner_object_id);
    await this.requireAttachmentBinary(attachment);

    const token = randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.parse(this.runtime.now()) + 5 * 60 * 1000).toISOString();
    this.renderTokens.set(token, {
      attachmentId,
      token,
      expiresAt,
      disposition,
    });

    return {
      attachment_id: attachment.id,
      render_url: `/api/attachments/${attachment.id}/render/${token}`,
      expires_at: expiresAt,
      content_type: attachment.content_type,
      disposition,
    };
  }

  async renderAttachment(attachmentId: string, token: string, response: RenderResponse): Promise<void> {
    const tokenRecord = this.renderTokens.get(token);
    if (tokenRecord === undefined || tokenRecord.attachmentId !== attachmentId) {
      throw new NotFoundException('Attachment render URL was not found');
    }
    if (Date.parse(this.runtime.now()) > Date.parse(tokenRecord.expiresAt)) {
      this.renderTokens.delete(token);
      throw new GoneException('Attachment render URL has expired');
    }

    const attachment = await this.requireAttachment(attachmentId);
    await this.assertAttachmentRenderable(attachment);
    await this.assertObjectReadable(attachment.owner_object_type, attachment.owner_object_id);

    const bytes = await this.requireAttachmentBinary(attachment);

    response.status(200);
    response.setHeader('content-type', attachment.content_type);
    response.setHeader('content-length', String(bytes.length));
    response.setHeader('content-disposition', `${tokenRecord.disposition}; filename="${sanitizeFilename(attachment.filename)}"`);
    response.send(Buffer.from(bytes));
  }

  async listForObject(objectType: string, objectId: string): Promise<AttachmentRef[]> {
    if (!attachmentOwnerTypes.has(objectType as AttachmentUploadMetadata['object_type'])) {
      throw new BadRequestException('object_type is not supported for attachments');
    }
    await this.assertObjectReadable(objectType, objectId);
    const attachments = await this.repository.listAttachmentsForObject(objectType, objectId);
    return attachments.map((attachment) => this.toPublicRef(attachment));
  }

  async getPublicMetadata(attachmentId: string): Promise<AttachmentRef> {
    const attachment = await this.requireAttachment(attachmentId);
    await this.assertObjectReadable(attachment.owner_object_type, attachment.owner_object_id);
    return this.toPublicRef(attachment);
  }

  async getReferenceableAttachment(attachmentId: string, objectRef: { type: string; id: string }): Promise<AttachmentRef | undefined> {
    const attachment = await this.repository.getAttachment(attachmentId);
    if (attachment === undefined) {
      return undefined;
    }
    if (!this.attachmentBelongsToObject(attachment, objectRef)) {
      return undefined;
    }
    if (attachment.reference_status !== 'active' || attachment.safety_status === 'blocked' || attachment.safety_status === 'unavailable') {
      return undefined;
    }
    await this.assertObjectReadable(objectRef.type, objectRef.id);
    return this.toPublicRef(attachment);
  }

  async updateMetadata(attachmentId: string, patch: AttachmentPatch): Promise<AttachmentRef> {
    const parsed = attachmentPatchSchema.parse(patch);
    const attachment = await this.requireAttachment(attachmentId);
    await this.assertObjectWritable(attachment.owner_object_type, attachment.owner_object_id);
    const updated: Attachment = {
      ...attachment,
      ...(parsed.caption !== undefined ? { caption: parsed.caption } : {}),
      ...(parsed.alt_text !== undefined ? { alt_text: parsed.alt_text } : {}),
      ...(parsed.evidence_category !== undefined ? { evidence_category: parsed.evidence_category } : {}),
      ...(parsed.visibility !== undefined ? { visibility: parsed.visibility } : {}),
    };
    await this.repository.saveAttachment(updated);
    return this.toPublicRef(updated);
  }

  async linkToObject(attachmentId: string, objectRef: ObjectRef): Promise<AttachmentRef> {
    const parsed = objectRefSchema.parse(objectRef);
    if (!attachmentRefObjectTypes.has(parsed.type)) {
      throw new BadRequestException('Attachment links require an editable typed object reference');
    }

    const attachment = await this.requireAttachment(attachmentId);
    await this.assertObjectReadable(attachment.owner_object_type, attachment.owner_object_id);
    await this.assertObjectWritable(parsed.type, parsed.id);
    const updated = await this.repository.linkAttachmentToObject(attachmentId, parsed);
    return this.toPublicRef(updated);
  }

  async archiveOrDelete(attachmentId: string): Promise<AttachmentRef> {
    const attachment = await this.requireAttachment(attachmentId);
    await this.assertObjectWritable(attachment.owner_object_type, attachment.owner_object_id);
    const archived = await this.repository.archiveAttachment(attachmentId, this.runtime.now());
    return this.toPublicRef(archived);
  }

  toPublicRef(attachment: Attachment): AttachmentRef {
    return attachmentRefSchema.parse({
      id: attachment.id,
      owner_object_type: attachment.owner_object_type,
      owner_object_id: attachment.owner_object_id,
      linked_object_refs: attachment.linked_object_refs,
      filename: attachment.filename,
      content_type: attachment.content_type,
      size_bytes: attachment.size_bytes,
      checksum_sha256: attachment.checksum_sha256,
      uploaded_by_actor_id: attachment.uploaded_by_actor_id,
      created_at: attachment.created_at,
      evidence_category: attachment.evidence_category,
      ...(attachment.caption !== undefined ? { caption: attachment.caption } : {}),
      ...(attachment.alt_text !== undefined ? { alt_text: attachment.alt_text } : {}),
      visibility: attachment.visibility,
      safety_status: attachment.safety_status,
      reference_status: attachment.reference_status,
    });
  }

  private parseUploadMetadata(metadataJson: string): AttachmentUploadMetadata {
    let raw: unknown;
    try {
      raw = JSON.parse(metadataJson);
    } catch {
      throw new BadRequestException('Attachment metadata must be valid JSON');
    }

    const parsed = attachmentUploadMetadataSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Attachment metadata validation failed', issues: parsed.error.issues });
    }
    return parsed.data;
  }

  private validateFile(file: UploadedAttachmentFile, category: AttachmentUploadMetadata['evidence_category']): void {
    if (file.size <= 0) {
      throw new BadRequestException('Attachment file cannot be empty');
    }
    if (file.size > categorySizeLimitBytes[category]) {
      throw new BadRequestException('Attachment file exceeds the category size limit');
    }

    const extension = extensionFor(file.originalname);
    const expectedContentType = contentTypeByExtension.get(extension);
    if (expectedContentType === undefined) {
      throw new BadRequestException('Attachment file extension is not supported');
    }
    if (file.mimetype !== expectedContentType) {
      throw new BadRequestException('Attachment file extension does not match content type');
    }
  }

  private async requireAttachment(attachmentId: string): Promise<Attachment> {
    const attachment = await this.repository.getAttachment(attachmentId);
    if (attachment === undefined) {
      throw new NotFoundException(`Attachment ${attachmentId} not found`);
    }
    return attachment;
  }

  private async assertAttachmentRenderable(attachment: Attachment): Promise<void> {
    if (attachment.reference_status !== 'active') {
      throw new GoneException('Attachment is no longer active');
    }
    if (attachment.safety_status !== 'passed') {
      throw new ForbiddenException('Attachment is not safe to render');
    }
  }

  private async writeAttachmentBinary(storageUri: string, bytes: Buffer): Promise<void> {
    await mkdir(this.storageRoot, { recursive: true });
    await writeFile(this.storagePathForUri(storageUri), bytes);
  }

  private async requireAttachmentBinary(attachment: Attachment): Promise<Buffer> {
    try {
      return await readFile(this.storagePathForUri(attachment.storage_uri));
    } catch {
      throw new NotFoundException('Attachment binary was not found');
    }
  }

  private storagePathForUri(storageUri: string): string {
    let parsed: URL;
    try {
      parsed = new URL(storageUri);
    } catch {
      throw new NotFoundException('Attachment binary was not found');
    }
    const attachmentId = parsed.pathname.replace(/^\//, '');
    if (
      parsed.protocol !== 'local:' ||
      parsed.hostname !== 'attachments' ||
      attachmentId.length === 0 ||
      !/^[a-zA-Z0-9_-]+$/.test(attachmentId)
    ) {
      throw new NotFoundException('Attachment binary was not found');
    }
    return join(this.storageRoot, attachmentId);
  }

  private async assertObjectReadable(objectType: string, objectId: string): Promise<void> {
    await this.assertObjectExists(objectType, objectId);
  }

  private async assertObjectWritable(objectType: string, objectId: string): Promise<void> {
    await this.assertObjectExists(objectType, objectId);
  }

  private async assertObjectExists(objectType: string, objectId: string): Promise<void> {
    if (objectType === 'requirement' || objectType === 'initiative' || objectType === 'bug' || objectType === 'tech_debt') {
      const workItem = await this.repository.getWorkItem(objectId);
      if (workItem === undefined || workItem.kind !== objectType) {
        throw new NotFoundException(`Object ${objectType}/${objectId} not found`);
      }
      return;
    }
    if (objectType === 'task') {
      if ((await this.repository.getTask(objectId)) === undefined) {
        throw new NotFoundException(`Object ${objectType}/${objectId} not found`);
      }
      return;
    }
    if (objectType === 'spec') {
      if ((await this.repository.getSpec(objectId)) === undefined) {
        throw new NotFoundException(`Object ${objectType}/${objectId} not found`);
      }
      return;
    }
    if (objectType === 'plan') {
      if ((await this.repository.getPlan(objectId)) === undefined) {
        throw new NotFoundException(`Object ${objectType}/${objectId} not found`);
      }
      return;
    }
    if (objectType === 'release') {
      if ((await this.repository.getRelease(objectId)) === undefined) {
        throw new NotFoundException(`Object ${objectType}/${objectId} not found`);
      }
      return;
    }
    throw new BadRequestException(`Object type ${objectType} is not supported for attachments`);
  }

  private attachmentBelongsToObject(attachment: Attachment, objectRef: { type: string; id: string }): boolean {
    return (
      (attachment.owner_object_type === objectRef.type && attachment.owner_object_id === objectRef.id) ||
      attachment.linked_object_refs.some((ref) => ref.type === objectRef.type && ref.id === objectRef.id)
    );
  }
}

function extensionFor(filename: string): string {
  const lastDotIndex = filename.lastIndexOf('.');
  return lastDotIndex < 0 ? '' : filename.slice(lastDotIndex).toLowerCase();
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/["\r\n]/g, '_');
}
