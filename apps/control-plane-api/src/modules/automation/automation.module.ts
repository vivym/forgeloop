import { Module } from '@nestjs/common';

import { AutomationController } from './automation.controller';
import { TrustedAutomationActorGuard } from './trusted-automation-actor.guard';

@Module({
  controllers: [AutomationController],
  providers: [TrustedAutomationActorGuard],
})
export class AutomationModule {}
