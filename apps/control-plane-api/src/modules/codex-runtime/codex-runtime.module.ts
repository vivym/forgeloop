import { Module } from '@nestjs/common';

import { ProductGenerationResultService } from '../automation/product-generation-result.service';
import { TrustedAutomationActorGuard } from '../automation/trusted-automation-actor.guard';
import { BrainstormingModule } from '../brainstorming/brainstorming.module';
import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { SpecPlanModule } from '../spec-plan/spec-plan.module';
import { CodexRuntimeController } from './codex-runtime.controller';
import { CodexRuntimeService } from './codex-runtime.service';
import { TrustedCodexRuntimeSetupGuard } from './trusted-codex-runtime-setup.guard';

@Module({
  imports: [ControlPlaneCoreModule, BrainstormingModule, SpecPlanModule],
  controllers: [CodexRuntimeController],
  providers: [CodexRuntimeService, ProductGenerationResultService, TrustedAutomationActorGuard, TrustedCodexRuntimeSetupGuard],
  exports: [CodexRuntimeService],
})
export class CodexRuntimeModule {}
