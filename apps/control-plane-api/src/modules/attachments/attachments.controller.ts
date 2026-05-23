import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  attachmentLinkRequestSchema,
  attachmentPatchSchema,
  type AttachmentLinkRequest,
  type AttachmentPatch,
} from '@forgeloop/contracts';

import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { AttachmentsService } from './attachments.service';

type RenderResponse = Parameters<AttachmentsService['renderAttachment']>[2];

@Controller()
export class AttachmentsController {
  constructor(@Inject(AttachmentsService) private readonly service: AttachmentsService) {}

  @Post('attachments')
  @UseInterceptors(FileInterceptor('file'))
  uploadAttachment(@UploadedFile() file: Parameters<AttachmentsService['upload']>[0], @Body('metadata') metadata: unknown) {
    return this.service.upload(file, metadata);
  }

  @Post('attachments/:attachmentId/render-url')
  createRenderUrl(@Param('attachmentId') attachmentId: string, @Body() body: { disposition?: 'inline' | 'download' }) {
    return this.service.createRenderUrl(attachmentId, body.disposition ?? 'inline');
  }

  @Get('attachments/:attachmentId/render/:token')
  renderAttachment(@Param('attachmentId') attachmentId: string, @Param('token') token: string, @Res() response: RenderResponse) {
    return this.service.renderAttachment(attachmentId, token, response);
  }

  @Get('attachments')
  listAttachments(@Query('object_type') objectType: string, @Query('object_id') objectId: string) {
    return this.service.listForObject(objectType, objectId);
  }

  @Get('attachments/:attachmentId')
  getAttachment(@Param('attachmentId') attachmentId: string) {
    return this.service.getPublicMetadata(attachmentId);
  }

  @Patch('attachments/:attachmentId')
  updateAttachment(
    @Param('attachmentId') attachmentId: string,
    @Body(new ZodValidationPipe(attachmentPatchSchema)) body: AttachmentPatch,
  ) {
    return this.service.updateMetadata(attachmentId, body);
  }

  @Post('attachments/:attachmentId/links')
  linkAttachment(
    @Param('attachmentId') attachmentId: string,
    @Body(new ZodValidationPipe(attachmentLinkRequestSchema)) body: AttachmentLinkRequest,
  ) {
    return this.service.linkToObject(attachmentId, body.object_ref);
  }

  @Delete('attachments/:attachmentId')
  deleteAttachment(@Param('attachmentId') attachmentId: string) {
    return this.service.archiveOrDelete(attachmentId);
  }
}
