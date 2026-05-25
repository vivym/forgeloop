import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { ProductGenerationRuntimeSchedulerModule } from '../codex-runtime/product-generation-runtime-scheduler.module';
import { WorkItemsModule } from '../work-items/work-items.module';
import { SpecPlanController } from './spec-plan.controller';
import { SpecPlanService } from './spec-plan.service';

@Module({
  imports: [ControlPlaneCoreModule, AuditModule, ProductGenerationRuntimeSchedulerModule, WorkItemsModule],
  controllers: [SpecPlanController],
  providers: [SpecPlanService],
  exports: [SpecPlanService],
})
export class SpecPlanModule {}
