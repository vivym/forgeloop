import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';

import {
  actorCommandSchema,
  createExecutionPackageSchema,
  createPlanRevisionSchema,
  createProjectRepoSchema,
  createProjectSchema,
  createSpecRevisionSchema,
  createWorkItemSchema,
  patchExecutionPackageSchema,
  reviewDecisionSchema,
  runPackageSchema,
} from './dto';
import type {
  ActorCommandDto,
  CreateExecutionPackageDto,
  CreatePlanRevisionDto,
  CreateProjectDto,
  CreateProjectRepoDto,
  CreateSpecRevisionDto,
  CreateWorkItemDto,
  PatchExecutionPackageDto,
  ReviewDecisionDto,
  RunPackageDto,
} from './dto';
import { P0Service } from './p0.service';
import { ZodValidationPipe } from './zod-validation.pipe';

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

  @Get('work-items/:workItemId/cockpit')
  cockpit(@Param('workItemId') workItemId: string) {
    return this.service.cockpit(workItemId);
  }

  @Get('work-items/:workItemId/timeline')
  timeline(@Param('workItemId') workItemId: string) {
    return this.service.timeline(workItemId);
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
  submitSpec(@Param('specId') specId: string, @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto) {
    return this.service.submitSpecForApproval(specId, body);
  }

  @Post('specs/:specId/approve')
  approveSpec(@Param('specId') specId: string, @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto) {
    return this.service.approveSpec(specId, body);
  }

  @Post('specs/:specId/request-changes')
  requestSpecChanges(@Param('specId') specId: string, @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto) {
    return this.service.requestSpecChanges(specId, body);
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
  submitPlan(@Param('planId') planId: string, @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto) {
    return this.service.submitPlanForApproval(planId, body);
  }

  @Post('plans/:planId/approve')
  approvePlan(@Param('planId') planId: string, @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto) {
    return this.service.approvePlan(planId, body);
  }

  @Post('plans/:planId/request-changes')
  requestPlanChanges(@Param('planId') planId: string, @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto) {
    return this.service.requestPlanChanges(planId, body);
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
  markPackageReady(@Param('packageId') packageId: string, @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto) {
    return this.service.markPackageReady(packageId, body);
  }

  @Post('execution-packages/:packageId/run')
  runPackage(@Param('packageId') packageId: string, @Body(new ZodValidationPipe(runPackageSchema)) body: RunPackageDto) {
    return this.service.runPackage(packageId, body, 'run');
  }

  @Post('execution-packages/:packageId/rerun')
  rerunPackage(@Param('packageId') packageId: string, @Body(new ZodValidationPipe(runPackageSchema)) body: RunPackageDto) {
    return this.service.runPackage(packageId, body, 'rerun');
  }

  @Post('execution-packages/:packageId/force-rerun')
  forceRerunPackage(@Param('packageId') packageId: string, @Body(new ZodValidationPipe(runPackageSchema)) body: RunPackageDto) {
    return this.service.runPackage(packageId, body, 'force_rerun');
  }

  @Get('run-sessions/:runSessionId')
  getRunSession(@Param('runSessionId') runSessionId: string) {
    return this.service.getRunSession(runSessionId);
  }

  @Get('review-packets/:reviewPacketId')
  getReviewPacket(@Param('reviewPacketId') reviewPacketId: string) {
    return this.service.getReviewPacket(reviewPacketId);
  }

  @Post('review-packets/:reviewPacketId/approve')
  approveReviewPacket(
    @Param('reviewPacketId') reviewPacketId: string,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
  ) {
    return this.service.approveReviewPacket(reviewPacketId, body);
  }

  @Post('review-packets/:reviewPacketId/request-changes')
  requestReviewChanges(
    @Param('reviewPacketId') reviewPacketId: string,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
  ) {
    return this.service.requestReviewChanges(reviewPacketId, body);
  }
}
