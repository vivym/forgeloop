import { Module } from '@nestjs/common';

import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { TrustedAutomationActorGuard } from '../automation/trusted-automation-actor.guard';
import { CodexSessionLeaseService } from './codex-session-lease.service';
import { InternalCodexSessionController } from './internal-codex-session.controller';
import { PlanItemWorkflowController } from './plan-item-workflow.controller';
import { PlanItemWorkflowService } from './plan-item-workflow.service';

@Module({
  imports: [ControlPlaneCoreModule],
  controllers: [PlanItemWorkflowController, InternalCodexSessionController],
  providers: [PlanItemWorkflowService, CodexSessionLeaseService, TrustedAutomationActorGuard],
  exports: [PlanItemWorkflowService, CodexSessionLeaseService],
})
export class PlanItemWorkflowsModule {}
