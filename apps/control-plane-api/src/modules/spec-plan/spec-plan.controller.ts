import { Body, Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';

import { actorContextFromHeaders } from '../auth/actor-context';
import {
  actorCommandSchema,
  createPlanRevisionSchema,
  createSpecRevisionSchema,
  type ActorCommandDto,
  type CreatePlanRevisionDto,
  type CreateSpecRevisionDto,
} from '../delivery/dto';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { SpecPlanService } from './spec-plan.service';

@Controller()
export class SpecPlanController {
  constructor(@Inject(SpecPlanService) private readonly specPlanService: SpecPlanService) {}

  @Post('work-items/:workItemId/specs')
  createSpec(@Param('workItemId') workItemId: string) {
    return this.specPlanService.createSpec(workItemId);
  }

  @Get('specs/:specId')
  getSpec(@Param('specId') specId: string) {
    return this.specPlanService.getSpec(specId);
  }

  @Get('specs/:specId/revisions')
  listSpecRevisions(@Param('specId') specId: string) {
    return this.specPlanService.listSpecRevisions(specId);
  }

  @Get('spec-revisions/:specRevisionId')
  getSpecRevision(@Param('specRevisionId') specRevisionId: string) {
    return this.specPlanService.getSpecRevision(specRevisionId);
  }

  @Post('specs/:specId/revisions')
  createSpecRevision(
    @Param('specId') specId: string,
    @Body(new ZodValidationPipe(createSpecRevisionSchema)) body: CreateSpecRevisionDto,
  ) {
    return this.specPlanService.createSpecRevision(specId, body);
  }

  @Post('specs/:specId/generate-draft')
  generateSpecDraft(@Param('specId') specId: string) {
    return this.specPlanService.generateSpecDraft(specId);
  }

  @Post('specs/:specId/submit-for-approval')
  submitSpec(
    @Param('specId') specId: string,
    @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.specPlanService.submitSpecForApproval(specId, body, actorContextFromHeaders(headers));
  }

  @Post('specs/:specId/approve')
  approveSpec(
    @Param('specId') specId: string,
    @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.specPlanService.approveSpec(specId, body, actorContextFromHeaders(headers));
  }

  @Post('specs/:specId/request-changes')
  requestSpecChanges(
    @Param('specId') specId: string,
    @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.specPlanService.requestSpecChanges(specId, body, actorContextFromHeaders(headers));
  }

  @Post('work-items/:workItemId/plans')
  createPlan(@Param('workItemId') workItemId: string) {
    return this.specPlanService.createPlan(workItemId);
  }

  @Get('plans/:planId')
  getPlan(@Param('planId') planId: string) {
    return this.specPlanService.getPlan(planId);
  }

  @Get('plans/:planId/revisions')
  listPlanRevisions(@Param('planId') planId: string) {
    return this.specPlanService.listPlanRevisions(planId);
  }

  @Get('plan-revisions/:planRevisionId')
  getPlanRevision(@Param('planRevisionId') planRevisionId: string) {
    return this.specPlanService.getPlanRevision(planRevisionId);
  }

  @Post('plans/:planId/revisions')
  createPlanRevision(
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(createPlanRevisionSchema)) body: CreatePlanRevisionDto,
  ) {
    return this.specPlanService.createPlanRevision(planId, body);
  }

  @Post('plans/:planId/generate-draft')
  generatePlanDraft(@Param('planId') planId: string) {
    return this.specPlanService.generatePlanDraft(planId);
  }

  @Post('plans/:planId/submit-for-approval')
  submitPlan(
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.specPlanService.submitPlanForApproval(planId, body, actorContextFromHeaders(headers));
  }

  @Post('plans/:planId/approve')
  approvePlan(
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.specPlanService.approvePlan(planId, body, actorContextFromHeaders(headers));
  }

  @Post('plans/:planId/request-changes')
  requestPlanChanges(
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.specPlanService.requestPlanChanges(planId, body, actorContextFromHeaders(headers));
  }
}
