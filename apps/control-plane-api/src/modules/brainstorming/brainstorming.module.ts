import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ProductGenerationRuntimeSchedulerModule } from '../codex-runtime/product-generation-runtime-scheduler.module';
import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { BrainstormingController } from './brainstorming.controller';
import { BrainstormingService } from './brainstorming.service';

@Module({
  imports: [ControlPlaneCoreModule, AuditModule, ProductGenerationRuntimeSchedulerModule],
  controllers: [BrainstormingController],
  providers: [BrainstormingService],
  exports: [BrainstormingService],
})
export class BrainstormingModule {}
