import { Module } from '@nestjs/common';

import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { PlanItemWorkflowsModule } from '../plan-item-workflows/plan-item-workflows.module';
import { SessionOperationsController } from './session-operations.controller';
import { SessionOperationsService } from './session-operations.service';

@Module({
  imports: [ControlPlaneCoreModule, PlanItemWorkflowsModule],
  controllers: [SessionOperationsController],
  providers: [SessionOperationsService],
  exports: [SessionOperationsService],
})
export class SessionOperationsModule {}
