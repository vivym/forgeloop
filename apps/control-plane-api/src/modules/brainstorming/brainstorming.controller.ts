import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { BrainstormingService } from './brainstorming.service';

const nonEmptyString = z.string().trim().min(1);

const revisionCompareQuerySchema = z
  .object({
    base_revision_id: nonEmptyString,
    compare_revision_id: nonEmptyString,
  })
  .strict();

type RevisionCompareQueryDto = z.infer<typeof revisionCompareQuerySchema>;

@Controller()
export class BrainstormingController {
  constructor(@Inject(BrainstormingService) private readonly service: BrainstormingService) {}

  @Get('boundary-brainstorming-sessions/:sessionId')
  getBoundaryBrainstormingSession(@Param('sessionId') sessionId: string) {
    return this.service.getBoundaryBrainstormingSession(sessionId);
  }

  @Get('development-plans/:developmentPlanId/items/:itemId/revisions')
  listDevelopmentPlanItemRevisions(@Param('developmentPlanId') developmentPlanId: string, @Param('itemId') itemId: string) {
    return this.service.listDevelopmentPlanItemRevisions(developmentPlanId, itemId);
  }

  @Get('development-plans/:developmentPlanId/items/:itemId/revisions/compare')
  compareDevelopmentPlanItemRevisions(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Query(new ZodValidationPipe(revisionCompareQuerySchema)) query: RevisionCompareQueryDto,
  ) {
    return this.service.compareDevelopmentPlanItemRevisions(developmentPlanId, itemId, query);
  }

  @Get('boundary-summaries/:boundarySummaryId/revisions')
  listBoundarySummaryRevisions(@Param('boundarySummaryId') boundarySummaryId: string) {
    return this.service.listBoundarySummaryRevisions(boundarySummaryId);
  }

  @Get('boundary-summaries/:boundarySummaryId/revisions/compare')
  compareBoundarySummaryRevisions(
    @Param('boundarySummaryId') boundarySummaryId: string,
    @Query(new ZodValidationPipe(revisionCompareQuerySchema)) query: RevisionCompareQueryDto,
  ) {
    return this.service.compareBoundarySummaryRevisions(boundarySummaryId, query);
  }
}
