import { Module } from '@nestjs/common';

import { BrainstormingModule } from '../brainstorming/brainstorming.module';
import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { TrustedAutomationActorGuard } from '../automation/trusted-automation-actor.guard';
import { ExecutionsModule } from '../executions/executions.module';
import { RunControlModule } from '../run-control/run-control.module';
import { SpecPlanModule } from '../spec-plan/spec-plan.module';
import { CodexSessionLeaseService } from './codex-session-lease.service';
import { InternalCodexSessionController } from './internal-codex-session.controller';
import { PlanItemWorkflowController } from './plan-item-workflow.controller';
import { PlanItemWorkflowService } from './plan-item-workflow.service';

@Module({
  imports: [ControlPlaneCoreModule, BrainstormingModule, SpecPlanModule, ExecutionsModule, RunControlModule],
  controllers: [PlanItemWorkflowController, InternalCodexSessionController],
  providers: [PlanItemWorkflowService, CodexSessionLeaseService, TrustedAutomationActorGuard],
  exports: [PlanItemWorkflowService, CodexSessionLeaseService],
})
export class PlanItemWorkflowsModule {}
