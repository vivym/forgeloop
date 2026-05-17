import { Module } from '@nestjs/common';

import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { AutomationActionService } from './automation-action.service';
import { AutomationCommandService } from './automation-command.service';
import { AutomationSettingsController } from './automation-settings.controller';
import { AutomationController } from './automation.controller';
import { RuntimeSnapshotService } from './runtime-snapshot.service';
import { TrustedAutomationActorGuard } from './trusted-automation-actor.guard';

@Module({
  imports: [ControlPlaneCoreModule],
  controllers: [AutomationController, AutomationSettingsController],
  providers: [AutomationActionService, AutomationCommandService, RuntimeSnapshotService, TrustedAutomationActorGuard],
  exports: [AutomationCommandService],
})
export class AutomationModule {}
