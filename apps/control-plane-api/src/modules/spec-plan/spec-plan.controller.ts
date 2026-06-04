import { Controller, Get, Inject, Param, Query } from '@nestjs/common';

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

  @Get('development-plans/:developmentPlanId/items/:itemId/spec/revisions/compare')
  compareItemSpecRevisions(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Query(new ZodValidationPipe(revisionCompareQuerySchema)) query: RevisionCompareQueryDto,
  ) {
    return this.specPlanService.compareItemSpecRevisions(developmentPlanId, itemId, query);
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
