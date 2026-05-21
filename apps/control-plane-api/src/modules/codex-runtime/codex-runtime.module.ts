import { Module } from '@nestjs/common';

import { TrustedAutomationActorGuard } from '../automation/trusted-automation-actor.guard';
import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { CodexRuntimeController } from './codex-runtime.controller';
import { CodexRuntimeService } from './codex-runtime.service';
import { TrustedCodexRuntimeSetupGuard } from './trusted-codex-runtime-setup.guard';

@Module({
  imports: [ControlPlaneCoreModule],
  controllers: [CodexRuntimeController],
  providers: [CodexRuntimeService, TrustedAutomationActorGuard, TrustedCodexRuntimeSetupGuard],
  exports: [CodexRuntimeService],
})
export class CodexRuntimeModule {}
