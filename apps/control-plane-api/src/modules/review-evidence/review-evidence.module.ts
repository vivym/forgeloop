import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { ReviewEvidenceService } from './review-evidence.service';
import { ReviewPacketsController } from './review-packets.controller';
import { WorkItemEvidenceController } from './work-item-evidence.controller';

@Module({
  imports: [ControlPlaneCoreModule, AuditModule],
  controllers: [ReviewPacketsController, WorkItemEvidenceController],
  providers: [ReviewEvidenceService],
  exports: [ReviewEvidenceService],
})
export class ReviewEvidenceModule {}
