import { Body, Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';

import { actorContextFromHeaders } from '../auth/actor-context';
import {
  approveArtifactCommandSchema,
  createPlanRevisionSchema,
  createSpecRevisionSchema,
  requestArtifactChangesCommandSchema,
  submitForApprovalCommandSchema,
  type ApproveArtifactCommandDto,
  type CreatePlanRevisionDto,
  type CreateSpecRevisionDto,
  type RequestArtifactChangesCommandDto,
  type SubmitForApprovalCommandDto,
} from '../delivery/dto';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { SpecPlanService } from './spec-plan.service';

@Controller()
export class SpecPlanController {
  constructor(@Inject(SpecPlanService) private readonly specPlanService: SpecPlanService) {}

  @Post('work-items/:workItemId/specs')
  createSpec(@Param('workItemId') workItemId: string) {
    return this.specPlanService.createPublicSpec(workItemId);
  }

  @Get('specs/:specId')
  getSpec(@Param('specId') specId: string) {
    return this.specPlanService.getPublicSpec(specId);
  }

  @Get('specs/:specId/revisions')
  listSpecRevisions(@Param('specId') specId: string) {
    return this.specPlanService.listPublicSpecRevisions(specId);
  }

  @Get('spec-revisions/:specRevisionId')
  getSpecRevision(@Param('specRevisionId') specRevisionId: string) {
    return this.specPlanService.getPublicSpecRevision(specRevisionId);
  }

  @Post('specs/:specId/revisions')
  createSpecRevision(
    @Param('specId') specId: string,
    @Body(new ZodValidationPipe(createSpecRevisionSchema)) body: CreateSpecRevisionDto,
  ) {
    return this.specPlanService.createPublicSpecRevision(specId, body);
  }

  @Post('specs/:specId/generate-draft')
  generateSpecDraft(@Param('specId') specId: string) {
    return this.specPlanService.generatePublicSpecDraft(specId);
  }

  @Post('specs/:specId/submit-for-approval')
  submitSpec(
    @Param('specId') specId: string,
    @Body(new ZodValidationPipe(submitForApprovalCommandSchema)) body: SubmitForApprovalCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.specPlanService.submitPublicSpecForApproval(specId, body, actorContextFromHeaders(headers));
  }

  @Post('specs/:specId/approve')
  approveSpec(
    @Param('specId') specId: string,
    @Body(new ZodValidationPipe(approveArtifactCommandSchema)) body: ApproveArtifactCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.specPlanService.approvePublicSpec(specId, body, actorContextFromHeaders(headers));
  }

  @Post('specs/:specId/request-changes')
  requestSpecChanges(
    @Param('specId') specId: string,
    @Body(new ZodValidationPipe(requestArtifactChangesCommandSchema)) body: RequestArtifactChangesCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.specPlanService.requestPublicSpecChanges(specId, body, actorContextFromHeaders(headers));
  }

  @Post('work-items/:workItemId/plans')
  createPlan(@Param('workItemId') workItemId: string) {
    return this.specPlanService.createPublicPlan(workItemId);
  }

  @Get('plans/:planId')
  getPlan(@Param('planId') planId: string) {
    return this.specPlanService.getPublicPlan(planId);
  }

  @Get('plans/:planId/revisions')
  listPlanRevisions(@Param('planId') planId: string) {
    return this.specPlanService.listPublicPlanRevisions(planId);
  }

  @Get('plan-revisions/:planRevisionId')
  getPlanRevision(@Param('planRevisionId') planRevisionId: string) {
    return this.specPlanService.getPublicPlanRevision(planRevisionId);
  }

  @Post('plans/:planId/revisions')
  createPlanRevision(
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(createPlanRevisionSchema)) body: CreatePlanRevisionDto,
  ) {
    return this.specPlanService.createPublicPlanRevision(planId, body);
  }

  @Post('plans/:planId/generate-draft')
  generatePlanDraft(@Param('planId') planId: string) {
    return this.specPlanService.generatePublicPlanDraft(planId);
  }

  @Post('plans/:planId/submit-for-approval')
  submitPlan(
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(submitForApprovalCommandSchema)) body: SubmitForApprovalCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.specPlanService.submitPublicPlanForApproval(planId, body, actorContextFromHeaders(headers));
  }

  @Post('plans/:planId/approve')
  approvePlan(
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(approveArtifactCommandSchema)) body: ApproveArtifactCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.specPlanService.approvePublicPlan(planId, body, actorContextFromHeaders(headers));
  }

  @Post('plans/:planId/request-changes')
  requestPlanChanges(
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(requestArtifactChangesCommandSchema)) body: RequestArtifactChangesCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.specPlanService.requestPublicPlanChanges(planId, body, actorContextFromHeaders(headers));
  }
}
