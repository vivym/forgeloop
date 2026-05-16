import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';

import {
  actorCommandSchema,
  createExecutionPackageSchema,
  createPlanRevisionSchema,
  createProjectRepoSchema,
  createProjectSchema,
  createSpecRevisionSchema,
  createWorkItemSchema,
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
  CreatePlanRevisionDto,
  CreateProjectDto,
  CreateProjectRepoDto,
  CreateSpecRevisionDto,
  CreateWorkItemDto,
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

  @Post('projects')
  createProject(@Body(new ZodValidationPipe(createProjectSchema)) body: CreateProjectDto) {
    return this.service.createProject(body);
  }

  @Post('projects/:projectId/repos')
  createProjectRepo(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createProjectRepoSchema)) body: CreateProjectRepoDto,
  ) {
    return this.service.createProjectRepo(projectId, body);
  }

  @Get('projects/:projectId/repos')
  listProjectRepos(@Param('projectId') projectId: string) {
    return this.service.listProjectRepos(projectId);
  }

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

  @Get('projects/:projectId')
  getProject(@Param('projectId') projectId: string) {
    return this.service.getProject(projectId);
  }

  @Post('work-items')
  createWorkItem(@Body(new ZodValidationPipe(createWorkItemSchema)) body: CreateWorkItemDto) {
    return this.service.createWorkItem(body);
  }

  @Get('work-items')
  listWorkItems(@Query('project_id') projectId?: string) {
    return this.service.listWorkItems(projectId);
  }

  @Get('work-items/:workItemId')
  getWorkItem(@Param('workItemId') workItemId: string) {
    return this.service.getWorkItem(workItemId);
  }

  @Get('work-items/:workItemId/evidence-chain')
  evidenceChain(@Param('workItemId') workItemId: string, @Query('review_packet_id') reviewPacketId?: string) {
    return this.service.evidenceChain(workItemId, reviewPacketId);
  }

  @Post('work-items/:workItemId/specs')
  createSpec(@Param('workItemId') workItemId: string) {
    return this.service.createSpec(workItemId);
  }

  @Get('specs/:specId')
  getSpec(@Param('specId') specId: string) {
    return this.service.getSpec(specId);
  }

  @Get('specs/:specId/revisions')
  listSpecRevisions(@Param('specId') specId: string) {
    return this.service.listSpecRevisions(specId);
  }

  @Get('spec-revisions/:specRevisionId')
  getSpecRevision(@Param('specRevisionId') specRevisionId: string) {
    return this.service.getSpecRevision(specRevisionId);
  }

  @Post('specs/:specId/revisions')
  createSpecRevision(
    @Param('specId') specId: string,
    @Body(new ZodValidationPipe(createSpecRevisionSchema)) body: CreateSpecRevisionDto,
  ) {
    return this.service.createSpecRevision(specId, body);
  }

  @Post('specs/:specId/generate-draft')
  generateSpecDraft(@Param('specId') specId: string) {
    return this.service.generateSpecDraft(specId);
  }

  @Post('specs/:specId/submit-for-approval')
  submitSpec(
    @Param('specId') specId: string,
    @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.submitSpecForApproval(specId, body, actorContextFromHeaders(headers));
  }

  @Post('specs/:specId/approve')
  approveSpec(
    @Param('specId') specId: string,
    @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.approveSpec(specId, body, actorContextFromHeaders(headers));
  }

  @Post('specs/:specId/request-changes')
  requestSpecChanges(
    @Param('specId') specId: string,
    @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.requestSpecChanges(specId, body, actorContextFromHeaders(headers));
  }

  @Post('work-items/:workItemId/plans')
  createPlan(@Param('workItemId') workItemId: string) {
    return this.service.createPlan(workItemId);
  }

  @Get('plans/:planId')
  getPlan(@Param('planId') planId: string) {
    return this.service.getPlan(planId);
  }

  @Get('plans/:planId/revisions')
  listPlanRevisions(@Param('planId') planId: string) {
    return this.service.listPlanRevisions(planId);
  }

  @Get('plan-revisions/:planRevisionId')
  getPlanRevision(@Param('planRevisionId') planRevisionId: string) {
    return this.service.getPlanRevision(planRevisionId);
  }

  @Post('plans/:planId/revisions')
  createPlanRevision(
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(createPlanRevisionSchema)) body: CreatePlanRevisionDto,
  ) {
    return this.service.createPlanRevision(planId, body);
  }

  @Post('plans/:planId/generate-draft')
  generatePlanDraft(@Param('planId') planId: string) {
    return this.service.generatePlanDraft(planId);
  }

  @Post('plans/:planId/submit-for-approval')
  submitPlan(
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.submitPlanForApproval(planId, body, actorContextFromHeaders(headers));
  }

  @Post('plans/:planId/approve')
  approvePlan(
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.approvePlan(planId, body, actorContextFromHeaders(headers));
  }

  @Post('plans/:planId/request-changes')
  requestPlanChanges(
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.requestPlanChanges(planId, body, actorContextFromHeaders(headers));
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
