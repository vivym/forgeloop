import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';

import {
  actorCommandSchema,
  createExecutionPackageSchema,
  disableAutomationCapabilitiesSchema,
  markPackageReadySchema,
  patchExecutionPackageSchema,
  reviewDecisionSchema,
  requestManualPathHoldSchema,
  resolveManualPathHoldSchema,
  runControlSchema,
  runInputSchema,
  runPackageSchema,
  setAutomationCapabilitiesSchema,
} from './dto';
import type {
  ActorCommandDto,
  CreateExecutionPackageDto,
  DisableAutomationCapabilitiesDto,
  MarkPackageReadyDto,
  PatchExecutionPackageDto,
  ReviewDecisionDto,
  RequestManualPathHoldDto,
  ResolveManualPathHoldDto,
  RunControlDto,
  RunInputDto,
  RunPackageDto,
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

  @Post('plan-revisions/:planRevisionId/generate-packages')
  generatePackages(@Param('planRevisionId') planRevisionId: string) {
    return this.service.generatePackages(planRevisionId);
  }

  @Post('plan-revisions/:planRevisionId/execution-packages')
  createExecutionPackage(
    @Param('planRevisionId') planRevisionId: string,
    @Body(new ZodValidationPipe(createExecutionPackageSchema)) body: CreateExecutionPackageDto,
  ) {
    return this.service.createExecutionPackage(planRevisionId, body);
  }

  @Get('work-items/:workItemId/execution-packages')
  listExecutionPackages(@Param('workItemId') workItemId: string) {
    return this.service.listExecutionPackages(workItemId);
  }

  @Get('execution-packages/:packageId')
  getExecutionPackage(@Param('packageId') packageId: string) {
    return this.service.getExecutionPackage(packageId);
  }

  @Patch('execution-packages/:packageId')
  patchExecutionPackage(
    @Param('packageId') packageId: string,
    @Body(new ZodValidationPipe(patchExecutionPackageSchema)) body: PatchExecutionPackageDto,
  ) {
    return this.service.patchExecutionPackage(packageId, body);
  }

  @Post('execution-packages/:packageId/mark-ready')
  markPackageReady(
    @Param('packageId') packageId: string,
    @Body(new ZodValidationPipe(markPackageReadySchema)) body: MarkPackageReadyDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.markPackageReady(packageId, body, actorContextFromHeaders(headers));
  }

  @Post('execution-packages/:packageId/run')
  runPackage(
    @Param('packageId') packageId: string,
    @Body(new ZodValidationPipe(runPackageSchema)) body: RunPackageDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.runPackage(packageId, body, 'run', actorContextFromHeaders(headers));
  }

  @Post('execution-packages/:packageId/rerun')
  rerunPackage(
    @Param('packageId') packageId: string,
    @Body(new ZodValidationPipe(runPackageSchema)) body: RunPackageDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.runPackage(packageId, body, 'rerun', actorContextFromHeaders(headers));
  }

  @Post('execution-packages/:packageId/force-rerun')
  forceRerunPackage(
    @Param('packageId') packageId: string,
    @Body(new ZodValidationPipe(runPackageSchema)) body: RunPackageDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.runPackage(packageId, body, 'force_rerun', actorContextFromHeaders(headers));
  }

  @Get('run-sessions/:runSessionId')
  getRunSession(@Param('runSessionId') runSessionId: string) {
    return this.service.getRunSession(runSessionId);
  }

  @Get('run-sessions/:runSessionId/events')
  listRunEvents(
    @Param('runSessionId') runSessionId: string,
    @Query('after') after?: string,
    @Query('actor_id') actorId?: string,
    @Query('stream_token') streamToken?: string,
    @Headers() headers?: Record<string, string | string[] | undefined>,
  ) {
    return this.service.listRunEvents(runSessionId, {
      ...(after === undefined ? {} : { after }),
      ...(actorId === undefined ? {} : { actorId }),
      ...(streamToken === undefined ? {} : { streamToken }),
      actorContext: actorContextFromHeaders(headers ?? {}),
    });
  }

  @Sse('run-sessions/:runSessionId/events/stream')
  streamRunEvents(
    @Param('runSessionId') runSessionId: string,
    @Query('after') after?: string,
    @Query('actor_id') actorId?: string,
    @Query('stream_token') streamToken?: string,
    @Headers() headers?: Record<string, string | string[] | undefined>,
  ): Promise<Observable<MessageEvent>> {
    return this.service.streamRunEvents(runSessionId, {
      ...(after === undefined ? {} : { after }),
      ...(actorId === undefined ? {} : { actorId }),
      ...(streamToken === undefined ? {} : { streamToken }),
      actorContext: actorContextFromHeaders(headers ?? {}),
    });
  }

  @Post('run-sessions/:runSessionId/events/stream-token')
  createRunEventStreamToken(
    @Param('runSessionId') runSessionId: string,
    @Query('actor_id') actorId?: string,
    @Body() body?: { actor_id?: string },
    @Headers() headers?: Record<string, string | string[] | undefined>,
  ) {
    const demoActorId = actorId ?? body?.actor_id;
    return this.service.createRunEventStreamToken(
      runSessionId,
      actorContextFromHeaders(headers ?? {}),
      demoActorId === undefined ? {} : { demoActorId },
    );
  }

  @Post('run-sessions/:runSessionId/input')
  sendRunInput(
    @Param('runSessionId') runSessionId: string,
    @Body(new ZodValidationPipe(runInputSchema)) body: RunInputDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.createRunInputCommand(runSessionId, body, actorContextFromHeaders(headers));
  }

  @Post('run-sessions/:runSessionId/cancel')
  cancelRun(
    @Param('runSessionId') runSessionId: string,
    @Body(new ZodValidationPipe(runControlSchema)) body: RunControlDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.createRunCancelCommand(runSessionId, body, actorContextFromHeaders(headers));
  }

  @Post('run-sessions/:runSessionId/resume')
  resumeRun(
    @Param('runSessionId') runSessionId: string,
    @Body(new ZodValidationPipe(runControlSchema)) body: RunControlDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.createRunResumeCommand(runSessionId, body, actorContextFromHeaders(headers));
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
