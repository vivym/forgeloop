import { Controller, Get, Post, UseGuards } from '@nestjs/common';

import type { AutomationActionResponseDto, AutomationRuntimeSnapshotDto } from './automation.dto';
import { TrustedAutomationActorGuard } from './trusted-automation-actor.guard';

@Controller('internal/automation')
@UseGuards(TrustedAutomationActorGuard)
export class AutomationController {
  @Get('runtime-snapshot')
  getRuntimeSnapshot(): AutomationRuntimeSnapshotDto {
    return {
      generated_at: new Date(0).toISOString(),
      projects: [],
      repos: [],
      work_items_requiring_plan: [],
      plan_revisions_requiring_packages: [],
      recent_action_runs: [],
      run_enqueue_disabled_reason: 'run_enqueue_disabled_by_scope',
    };
  }

  @Post('actions')
  createAction(): AutomationActionResponseDto {
    return { action: null };
  }
}
