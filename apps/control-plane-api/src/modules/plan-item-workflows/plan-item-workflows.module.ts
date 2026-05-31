import { Module } from '@nestjs/common';

import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { PlanItemWorkflowController } from './plan-item-workflow.controller';
import { PlanItemWorkflowService } from './plan-item-workflow.service';

@Module({
  imports: [ControlPlaneCoreModule],
  controllers: [PlanItemWorkflowController],
  providers: [PlanItemWorkflowService],
  exports: [PlanItemWorkflowService],
})
export class PlanItemWorkflowsModule {}
