import { Module } from '@nestjs/common';

import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { ProductGenerationRuntimeSchedulerService } from './product-generation-runtime-scheduler.service';

@Module({
  imports: [ControlPlaneCoreModule],
  providers: [ProductGenerationRuntimeSchedulerService],
  exports: [ProductGenerationRuntimeSchedulerService],
})
export class ProductGenerationRuntimeSchedulerModule {}
