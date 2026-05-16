import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query } from '@nestjs/common';

import {
  actorCommandSchema,
  disableAutomationCapabilitiesSchema,
  reviewDecisionSchema,
  requestManualPathHoldSchema,
  resolveManualPathHoldSchema,
  setAutomationCapabilitiesSchema,
} from './dto';
import type {
  ActorCommandDto,
  DisableAutomationCapabilitiesDto,
  ReviewDecisionDto,
  RequestManualPathHoldDto,
  ResolveManualPathHoldDto,
  SetAutomationCapabilitiesDto,
} from './dto';
import { actorContextFromHeaders } from '../modules/auth/actor-context';
import { ZodValidationPipe } from '../modules/http/zod-validation.pipe';
import { P0Service } from './p0.service';

@Controller()
export class P0Controller {
  constructor(@Inject(P0Service) private readonly service: P0Service) {}

  @Get('p0/projects/:projectId/automation/capabilities')
  getAutomationCapabilities(@Param('projectId') projectId: string, @Query('repo_id') repoId?: string) {
    return this.service.getAutomationCapabilities(projectId, repoId);
  }

  @Post('p0/projects/:projectId/automation/capabilities')
  setAutomationCapabilities(
    @Param('projectId') projectId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(setAutomationCapabilitiesSchema)) body: SetAutomationCapabilitiesDto,
  ) {
    return this.service.setAutomationCapabilities(projectId, body, actorContextFromHeaders(headers));
  }

  @Post('p0/projects/:projectId/automation/capabilities:disable')
  disableAutomationCapabilities(
    @Param('projectId') projectId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(disableAutomationCapabilitiesSchema)) body: DisableAutomationCapabilitiesDto,
  ) {
    return this.service.disableAutomation(projectId, body, actorContextFromHeaders(headers));
  }

  @Post('p0/manual-path-holds')
  requestManualPathHold(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(requestManualPathHoldSchema)) body: RequestManualPathHoldDto,
  ) {
    return this.service.requestManualPath(body, actorContextFromHeaders(headers));
  }

  @Post('p0/manual-path-holds/:holdId/resolve')
  resolveManualPathHold(
    @Param('holdId') holdId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(resolveManualPathHoldSchema)) body: ResolveManualPathHoldDto,
  ) {
    return this.service.resolveManualPath(holdId, body, actorContextFromHeaders(headers));
  }

  @Get('work-items/:workItemId/evidence-chain')
  evidenceChain(@Param('workItemId') workItemId: string, @Query('review_packet_id') reviewPacketId?: string) {
    return this.service.evidenceChain(workItemId, reviewPacketId);
  }

  @Get('review-packets/:reviewPacketId')
  getReviewPacket(@Param('reviewPacketId') reviewPacketId: string) {
    return this.service.getReviewPacket(reviewPacketId);
  }

  @Post('review-packets/:reviewPacketId/approve')
  approveReviewPacket(
    @Param('reviewPacketId') reviewPacketId: string,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.approveReviewPacket(reviewPacketId, body, actorContextFromHeaders(headers));
  }

  @Post('review-packets/:reviewPacketId/request-changes')
  requestReviewChanges(
    @Param('reviewPacketId') reviewPacketId: string,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.requestReviewChanges(reviewPacketId, body, actorContextFromHeaders(headers));
  }
}
