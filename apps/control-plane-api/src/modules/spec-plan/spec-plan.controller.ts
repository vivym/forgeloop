import { Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { DomainError } from '@forgeloop/domain';

import {
  revisionCompareQuerySchema,
  type RevisionCompareQueryDto,
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
  generateItemSpecDraft() {
    return this.legacyEntrypointDisabled('item-spec-generate-draft');
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/spec-revisions/generate')
  generateItemSpecRevisionRuntime() {
    return this.legacyEntrypointDisabled('item-spec-runtime-generate');
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/spec/submit-for-approval')
  submitItemSpec() {
    return this.legacyEntrypointDisabled('item-spec-submit');
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/spec/approve')
  approveItemSpec() {
    return this.legacyEntrypointDisabled('item-spec-approve');
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/spec/request-changes')
  requestItemSpecChanges() {
    return this.legacyEntrypointDisabled('item-spec-request-changes');
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/spec/reject')
  rejectItemSpec() {
    return this.legacyEntrypointDisabled('item-spec-reject');
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/spec/regenerate-draft')
  regenerateItemSpecDraft() {
    return this.legacyEntrypointDisabled('item-spec-regenerate-draft');
  }

  @Patch('development-plans/:developmentPlanId/items/:itemId/spec/draft')
  saveItemSpecDraft() {
    return this.legacyEntrypointDisabled('item-spec-save-draft');
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
  generateItemImplementationPlanDraft() {
    return this.legacyEntrypointDisabled('item-implementation-plan-generate-draft');
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan-revisions/generate')
  generateItemImplementationPlanRevisionRuntime() {
    return this.legacyEntrypointDisabled('item-implementation-plan-runtime-generate');
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/submit-for-approval')
  submitItemImplementationPlan() {
    return this.legacyEntrypointDisabled('item-implementation-plan-submit');
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/approve')
  approveItemImplementationPlan() {
    return this.legacyEntrypointDisabled('item-implementation-plan-approve');
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/request-changes')
  requestItemImplementationPlanChanges() {
    return this.legacyEntrypointDisabled('item-implementation-plan-request-changes');
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/reject')
  rejectItemImplementationPlan() {
    return this.legacyEntrypointDisabled('item-implementation-plan-reject');
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/regenerate-draft')
  regenerateItemImplementationPlanDraft() {
    return this.legacyEntrypointDisabled('item-implementation-plan-regenerate-draft');
  }

  @Patch('development-plans/:developmentPlanId/items/:itemId/implementation-plan/draft')
  saveItemImplementationPlanDraft() {
    return this.legacyEntrypointDisabled('item-implementation-plan-save-draft');
  }

  @Get('development-plans/:developmentPlanId/items/:itemId/implementation-plan/revisions/compare')
  compareItemImplementationPlanRevisions(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Query(new ZodValidationPipe(revisionCompareQuerySchema)) query: RevisionCompareQueryDto,
  ) {
    return this.specPlanService.compareItemImplementationPlanRevisions(developmentPlanId, itemId, query);
  }

  private legacyEntrypointDisabled(operation: string): never {
    throw new DomainError(
      'workflow_legacy_entrypoint_disabled',
      `workflow_legacy_entrypoint_disabled: ${operation} must use PlanItemWorkflow queued actions`,
    );
  }
}
