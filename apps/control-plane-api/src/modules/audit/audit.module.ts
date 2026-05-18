import { Module } from '@nestjs/common';

import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { AuditWriterService } from './audit-writer.service';

@Module({
  imports: [ControlPlaneCoreModule],
  providers: [AuditWriterService],
  exports: [AuditWriterService],
})
export class AuditModule {}
