import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { ReleaseController } from './release.controller';
import { ReleaseService } from './release.service';

@Module({
  imports: [ControlPlaneCoreModule, AuditModule],
  controllers: [ReleaseController],
  providers: [ReleaseService],
})
export class ReleaseModule {}
