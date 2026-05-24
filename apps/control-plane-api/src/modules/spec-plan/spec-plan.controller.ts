import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';

import {
  approveArtifactCommandSchema,
  regenerateArtifactDraftCommandSchema,
  rejectArtifactCommandSchema,
  requestArtifactChangesCommandSchema,
  revisionCompareQuerySchema,
  submitForApprovalCommandSchema,
  type ApproveArtifactCommandDto,
  type RegenerateArtifactDraftCommandDto,
  type RejectArtifactCommandDto,
  type RequestArtifactChangesCommandDto,
  type RevisionCompareQueryDto,
  type SubmitForApprovalCommandDto,
} from '../delivery/dto';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { SpecPlanService } from './spec-plan.service';

@Controller()
export class SpecPlanController {
  constructor(@Inject(SpecPlanService) private readonly specPlanService: SpecPlanService) {}

  @Get('spec-revisions/:specRevisionId')
  getSpecRevision(@Param('specRevisionId') specRevisionId: string) {
    return this.specPlanService.getPublicSpecRevision(specRevisionId);
  }

  @Get('plan-revisions/:planRevisionId')
  getPlanRevision(@Param('planRevisionId') planRevisionId: string) {
    return this.specPlanService.getPublicPlanRevision(planRevisionId);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/spec/generate-draft')
  generateItemSpecDraft(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(submitForApprovalCommandSchema)) body: SubmitForApprovalCommandDto,
  ) {
    return this.specPlanService.generateItemSpecDraft(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/spec/submit-for-approval')
  submitItemSpec(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(submitForApprovalCommandSchema)) body: SubmitForApprovalCommandDto,
  ) {
    return this.specPlanService.submitItemSpecForApproval(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/spec/approve')
  approveItemSpec(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(approveArtifactCommandSchema)) body: ApproveArtifactCommandDto,
  ) {
    return this.specPlanService.approveItemSpec(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/spec/request-changes')
  requestItemSpecChanges(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(requestArtifactChangesCommandSchema)) body: RequestArtifactChangesCommandDto,
  ) {
    return this.specPlanService.requestItemSpecChanges(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/spec/reject')
  rejectItemSpec(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(rejectArtifactCommandSchema)) body: RejectArtifactCommandDto,
  ) {
    return this.specPlanService.rejectItemSpec(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/spec/regenerate-draft')
  regenerateItemSpecDraft(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(regenerateArtifactDraftCommandSchema)) body: RegenerateArtifactDraftCommandDto,
  ) {
    return this.specPlanService.regenerateItemSpecDraft(developmentPlanId, itemId, body);
  }

  @Get('development-plans/:developmentPlanId/items/:itemId/spec/revisions/compare')
  compareItemSpecRevisions(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Query(new ZodValidationPipe(revisionCompareQuerySchema)) query: RevisionCompareQueryDto,
  ) {
    return this.specPlanService.compareItemSpecRevisions(developmentPlanId, itemId, query);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/execution-plan/generate-draft')
  generateItemExecutionPlanDraft(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(submitForApprovalCommandSchema)) body: SubmitForApprovalCommandDto,
  ) {
    return this.specPlanService.generateItemExecutionPlanDraft(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/execution-plan/submit-for-approval')
  submitItemExecutionPlan(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(submitForApprovalCommandSchema)) body: SubmitForApprovalCommandDto,
  ) {
    return this.specPlanService.submitItemExecutionPlanForApproval(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/execution-plan/approve')
  approveItemExecutionPlan(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(approveArtifactCommandSchema)) body: ApproveArtifactCommandDto,
  ) {
    return this.specPlanService.approveItemExecutionPlan(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/execution-plan/request-changes')
  requestItemExecutionPlanChanges(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(requestArtifactChangesCommandSchema)) body: RequestArtifactChangesCommandDto,
  ) {
    return this.specPlanService.requestItemExecutionPlanChanges(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/execution-plan/reject')
  rejectItemExecutionPlan(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(rejectArtifactCommandSchema)) body: RejectArtifactCommandDto,
  ) {
    return this.specPlanService.rejectItemExecutionPlan(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/execution-plan/regenerate-draft')
  regenerateItemExecutionPlanDraft(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(regenerateArtifactDraftCommandSchema)) body: RegenerateArtifactDraftCommandDto,
  ) {
    return this.specPlanService.regenerateItemExecutionPlanDraft(developmentPlanId, itemId, body);
  }

  @Get('development-plans/:developmentPlanId/items/:itemId/execution-plan/revisions/compare')
  compareItemExecutionPlanRevisions(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Query(new ZodValidationPipe(revisionCompareQuerySchema)) query: RevisionCompareQueryDto,
  ) {
    return this.specPlanService.compareItemExecutionPlanRevisions(developmentPlanId, itemId, query);
  }
}
