import { Module } from '@nestjs/common';

import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

@Module({
  imports: [ControlPlaneCoreModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
