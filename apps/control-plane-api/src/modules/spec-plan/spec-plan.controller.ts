import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { markdownDocumentSchema, type MarkdownDocument } from '@forgeloop/contracts';

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

  @Get('implementation-plan-revisions/:implementationPlanRevisionId')
  getImplementationPlanRevision(@Param('implementationPlanRevisionId') implementationPlanRevisionId: string) {
    return this.specPlanService.getPublicImplementationPlanRevision(implementationPlanRevisionId);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/spec/generate-draft')
  generateItemSpecDraft(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(submitForApprovalCommandSchema)) body: SubmitForApprovalCommandDto,
  ) {
    return this.specPlanService.generateItemSpecDraft(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/spec-revisions/generate')
  generateItemSpecRevisionRuntime(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(submitForApprovalCommandSchema)) body: SubmitForApprovalCommandDto,
  ) {
    return this.specPlanService.generateItemSpecRevisionRuntime(developmentPlanId, itemId, body);
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

  @Patch('development-plans/:developmentPlanId/items/:itemId/spec/draft')
  saveItemSpecDraft(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(markdownDocumentSchema)) body: MarkdownDocument,
  ) {
    return this.specPlanService.saveItemSpecDraft(developmentPlanId, itemId, body);
  }

  @Get('development-plans/:developmentPlanId/items/:itemId/spec/revisions/compare')
  compareItemSpecRevisions(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Query(new ZodValidationPipe(revisionCompareQuerySchema)) query: RevisionCompareQueryDto,
  ) {
    return this.specPlanService.compareItemSpecRevisions(developmentPlanId, itemId, query);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/generate-draft')
  generateItemImplementationPlanDraft(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(submitForApprovalCommandSchema)) body: SubmitForApprovalCommandDto,
  ) {
    return this.specPlanService.generateItemImplementationPlanDraft(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan-revisions/generate')
  generateItemImplementationPlanRevisionRuntime(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(submitForApprovalCommandSchema)) body: SubmitForApprovalCommandDto,
  ) {
    return this.specPlanService.generateItemImplementationPlanRevisionRuntime(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/submit-for-approval')
  submitItemImplementationPlan(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(submitForApprovalCommandSchema)) body: SubmitForApprovalCommandDto,
  ) {
    return this.specPlanService.submitItemImplementationPlanForApproval(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/approve')
  approveItemImplementationPlan(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(approveArtifactCommandSchema)) body: ApproveArtifactCommandDto,
  ) {
    return this.specPlanService.approveItemImplementationPlan(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/request-changes')
  requestItemImplementationPlanChanges(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(requestArtifactChangesCommandSchema)) body: RequestArtifactChangesCommandDto,
  ) {
    return this.specPlanService.requestItemImplementationPlanChanges(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/reject')
  rejectItemImplementationPlan(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(rejectArtifactCommandSchema)) body: RejectArtifactCommandDto,
  ) {
    return this.specPlanService.rejectItemImplementationPlan(developmentPlanId, itemId, body);
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/regenerate-draft')
  regenerateItemImplementationPlanDraft(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(regenerateArtifactDraftCommandSchema)) body: RegenerateArtifactDraftCommandDto,
  ) {
    return this.specPlanService.regenerateItemImplementationPlanDraft(developmentPlanId, itemId, body);
  }

  @Patch('development-plans/:developmentPlanId/items/:itemId/implementation-plan/draft')
  saveItemImplementationPlanDraft(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(markdownDocumentSchema)) body: MarkdownDocument,
  ) {
    return this.specPlanService.saveItemImplementationPlanDraft(developmentPlanId, itemId, body);
  }

  @Get('development-plans/:developmentPlanId/items/:itemId/implementation-plan/revisions/compare')
  compareItemImplementationPlanRevisions(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Query(new ZodValidationPipe(revisionCompareQuerySchema)) query: RevisionCompareQueryDto,
  ) {
    return this.specPlanService.compareItemImplementationPlanRevisions(developmentPlanId, itemId, query);
  }
}
