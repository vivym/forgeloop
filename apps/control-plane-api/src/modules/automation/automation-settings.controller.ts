import { Body, Controller, Get, Headers, Inject, Param, Post, Query } from '@nestjs/common';

import { actorContextFromHeaders } from '../auth/actor-context';
import {
  disableAutomationCapabilitiesSchema,
  requestManualPathHoldSchema,
  resolveManualPathHoldSchema,
  setAutomationCapabilitiesSchema,
  type DisableAutomationCapabilitiesDto,
  type RequestManualPathHoldDto,
  type ResolveManualPathHoldDto,
  type SetAutomationCapabilitiesDto,
} from '../delivery/dto';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { AutomationCommandService } from './automation-command.service';

@Controller('automation')
export class AutomationSettingsController {
  constructor(@Inject(AutomationCommandService) private readonly automationCommandService: AutomationCommandService) {}

  @Get('projects/:projectId/capabilities')
  getAutomationCapabilities(@Param('projectId') projectId: string, @Query('repo_id') repoId?: string) {
    return this.automationCommandService.getAutomationCapabilities(projectId, repoId);
  }

  @Post('projects/:projectId/capabilities')
  setAutomationCapabilities(
    @Param('projectId') projectId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(setAutomationCapabilitiesSchema)) body: SetAutomationCapabilitiesDto,
  ) {
    return this.automationCommandService.setAutomationCapabilities(projectId, body, actorContextFromHeaders(headers));
  }

  @Post('projects/:projectId/capabilities\\:disable')
  disableAutomation(
    @Param('projectId') projectId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(disableAutomationCapabilitiesSchema)) body: DisableAutomationCapabilitiesDto,
  ) {
    return this.automationCommandService.disableAutomation(projectId, body, actorContextFromHeaders(headers));
  }

  @Post('manual-path-holds')
  requestManualPath(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(requestManualPathHoldSchema)) body: RequestManualPathHoldDto,
  ) {
    return this.automationCommandService.requestManualPath(body, actorContextFromHeaders(headers));
  }

  @Post('manual-path-holds/:holdId/resolve')
  resolveManualPath(
    @Param('holdId') holdId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(resolveManualPathHoldSchema)) body: ResolveManualPathHoldDto,
  ) {
    return this.automationCommandService.resolveManualPath(holdId, body, actorContextFromHeaders(headers));
  }
}
