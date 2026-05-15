import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';

import { ZodValidationPipe } from '../../p0/zod-validation.pipe';
import { AutomationActionService } from './automation-action.service';
import {
  blockAutomationActionRunSchema,
  claimNextAutomationActionRunSchema,
  completeAutomationActionRunSchema,
  createAutomationActionRunSchema,
  failAutomationActionRunSchema,
  gatePendingAutomationActionRunSchema,
  type AutomationActionResponseDto,
  type AutomationRuntimeSnapshotDto,
  type BlockAutomationActionRunDto,
  type ClaimNextAutomationActionRunDto,
  type CompleteAutomationActionRunDto,
  type CreateAutomationActionRunDto,
  type FailAutomationActionRunDto,
  type GatePendingAutomationActionRunDto,
} from './automation.dto';
import { TrustedAutomationActorGuard } from './trusted-automation-actor.guard';

@Controller('internal/automation')
@UseGuards(TrustedAutomationActorGuard)
export class AutomationController {
  constructor(private readonly automationActionService: AutomationActionService) {}

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
  createAction(
    @Body(new ZodValidationPipe(createAutomationActionRunSchema)) body: CreateAutomationActionRunDto,
  ): Promise<AutomationActionResponseDto> {
    return this.automationActionService.createOrReplayAction(body);
  }

  @Post('actions\\:claim-next')
  @HttpCode(200)
  claimNextAction(
    @Body(new ZodValidationPipe(claimNextAutomationActionRunSchema)) body: ClaimNextAutomationActionRunDto,
  ): Promise<AutomationActionResponseDto> {
    return this.automationActionService.claimNextAction(body);
  }

  @Post('actions/:id/complete')
  @HttpCode(200)
  completeAction(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(completeAutomationActionRunSchema)) body: CompleteAutomationActionRunDto,
  ): Promise<AutomationActionResponseDto> {
    return this.automationActionService.completeAction(id, body);
  }

  @Post('actions/:id/gate-pending')
  @HttpCode(200)
  gatePendingAction(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(gatePendingAutomationActionRunSchema)) body: GatePendingAutomationActionRunDto,
  ): Promise<AutomationActionResponseDto> {
    return this.automationActionService.gatePendingAction(id, body);
  }

  @Post('actions/:id/block')
  @HttpCode(200)
  blockAction(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(blockAutomationActionRunSchema)) body: BlockAutomationActionRunDto,
  ): Promise<AutomationActionResponseDto> {
    return this.automationActionService.blockAction(id, body);
  }

  @Post('actions/:id/fail')
  @HttpCode(200)
  failAction(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(failAutomationActionRunSchema)) body: FailAutomationActionRunDto,
  ): Promise<AutomationActionResponseDto> {
    return this.automationActionService.failAction(id, body);
  }
}
