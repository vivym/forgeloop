import { Module } from '@nestjs/common';

import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { AutomationActionService } from './automation-action.service';
import { AutomationController } from './automation.controller';
import { TrustedAutomationActorGuard } from './trusted-automation-actor.guard';

@Module({
  imports: [ControlPlaneCoreModule],
  controllers: [AutomationController],
  providers: [AutomationActionService, TrustedAutomationActorGuard],
})
export class AutomationModule {}
