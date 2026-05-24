import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { DevelopmentPlansController } from './development-plans.controller';
import { DevelopmentPlansService } from './development-plans.service';

@Module({
  imports: [ControlPlaneCoreModule, AuditModule],
  controllers: [DevelopmentPlansController],
  providers: [DevelopmentPlansService],
  exports: [DevelopmentPlansService],
})
export class DevelopmentPlansModule {}
