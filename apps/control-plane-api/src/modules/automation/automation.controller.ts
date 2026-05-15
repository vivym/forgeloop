import { Body, Controller, Get, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  automationActorClassHeaderName,
  automationActorIdHeaderName,
  automationDaemonIdentityHeaderName,
} from '@forgeloop/automation';

import { ZodValidationPipe } from '../../p0/zod-validation.pipe';
import type { ActorContext } from '../../p0/actor-context';
import { AutomationActionService } from './automation-action.service';
import { AutomationCommandService } from './automation-command.service';
import {
  blockAutomationActionRunSchema,
  claimNextAutomationActionRunSchema,
  completeAutomationActionRunSchema,
  createAutomationActionRunSchema,
  ensurePackageDraftsCommandSchema,
  ensurePlanDraftCommandSchema,
  failAutomationActionRunSchema,
  gatePendingAutomationActionRunSchema,
  requestManualPathCommandSchema,
  type AutomationActionResponseDto,
  type AutomationRuntimeSnapshotDto,
  type BlockAutomationActionRunDto,
  type ClaimNextAutomationActionRunDto,
  type CompleteAutomationActionRunDto,
  type CreateAutomationActionRunDto,
  type EnsurePackageDraftsCommandDto,
  type EnsurePlanDraftCommandDto,
  type FailAutomationActionRunDto,
  type GatePendingAutomationActionRunDto,
  type RequestManualPathCommandDto,
} from './automation.dto';
import { TrustedAutomationActorGuard } from './trusted-automation-actor.guard';

const firstHeaderValue = (headers: Record<string, string | string[] | undefined>, name: string): string | undefined => {
  const direct = headers[name];
  if (direct !== undefined) {
    return Array.isArray(direct) ? direct[0] : direct;
  }
  const lowerName = name.toLowerCase();
  const found = Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === lowerName)?.[1];
  return Array.isArray(found) ? found[0] : found;
};

const actorContextFromAutomationHeaders = (headers: Record<string, string | string[] | undefined>): ActorContext => {
  const authenticatedActorId = firstHeaderValue(headers, automationActorIdHeaderName);
  const actorClass = firstHeaderValue(headers, automationActorClassHeaderName) as ActorContext['actorClass'];
  const daemonIdentity = firstHeaderValue(headers, automationDaemonIdentityHeaderName);
  return {
    ...(authenticatedActorId === undefined ? {} : { authenticatedActorId }),
    ...(actorClass === undefined ? {} : { actorClass }),
    ...(daemonIdentity === undefined ? {} : { daemonIdentity }),
  };
};

@Controller('internal/automation')
@UseGuards(TrustedAutomationActorGuard)
export class AutomationController {
  constructor(
    private readonly automationActionService: AutomationActionService,
    private readonly automationCommandService: AutomationCommandService,
  ) {}

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

  @Post('work-items/:workItemId/ensure-plan-draft')
  ensurePlanDraft(
    @Param('workItemId') workItemId: string,
    @Body(new ZodValidationPipe(ensurePlanDraftCommandSchema)) body: EnsurePlanDraftCommandDto,
  ) {
    return this.automationCommandService.ensurePlanDraftForClaimedAction(workItemId, body);
  }

  @Post('plan-revisions/:planRevisionId/ensure-package-drafts')
  ensurePackageDrafts(
    @Param('planRevisionId') planRevisionId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(ensurePackageDraftsCommandSchema)) body: EnsurePackageDraftsCommandDto,
  ) {
    return this.automationCommandService.ensurePackageDraftsForClaimedAction(
      planRevisionId,
      body,
      actorContextFromAutomationHeaders(headers),
    );
  }

  @Post('manual-path-holds')
  requestManualPathHold(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(requestManualPathCommandSchema)) body: RequestManualPathCommandDto,
  ) {
    return this.automationCommandService.requestManualPathForClaimedAction(body, actorContextFromAutomationHeaders(headers));
  }
}
