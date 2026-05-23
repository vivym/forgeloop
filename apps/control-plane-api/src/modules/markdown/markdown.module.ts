import { Module } from '@nestjs/common';

import { AttachmentsModule } from '../attachments/attachments.module';
import { MarkdownDocumentService } from './markdown-document.service';

@Module({
  imports: [AttachmentsModule],
  providers: [MarkdownDocumentService],
  exports: [MarkdownDocumentService],
})
export class MarkdownModule {}
