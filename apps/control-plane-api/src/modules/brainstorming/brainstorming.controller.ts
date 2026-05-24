import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { BrainstormingService } from './brainstorming.service';

const nonEmptyString = z.string().trim().min(1);

const startBrainstormingSessionSchema = z
  .object({
    actor_id: nonEmptyString,
  })
  .strict();

const answerQuestionSchema = z
  .object({
    question_id: nonEmptyString,
    text: nonEmptyString,
    actor_id: nonEmptyString,
  })
  .strict();

const recordDecisionSchema = z
  .object({
    text: nonEmptyString,
    rationale: nonEmptyString.optional(),
    actor_id: nonEmptyString,
  })
  .strict();

const approveBoundarySchema = z
  .object({
    confirmed_scope: z.array(nonEmptyString).default([]),
    confirmed_out_of_scope: z.array(nonEmptyString).default([]),
    accepted_assumptions: z.array(nonEmptyString).default([]),
    open_risks: z.array(nonEmptyString).default([]),
    validation_expectations: z.array(nonEmptyString).default([]),
    actor_id: nonEmptyString,
    final_decision: nonEmptyString.optional(),
  })
  .strict();

const revisionCompareQuerySchema = z
  .object({
    base_revision_id: nonEmptyString,
    compare_revision_id: nonEmptyString,
  })
  .strict();

type StartBrainstormingSessionDto = z.infer<typeof startBrainstormingSessionSchema>;
type AnswerQuestionDto = z.infer<typeof answerQuestionSchema>;
type RecordDecisionDto = z.infer<typeof recordDecisionSchema>;
type ApproveBoundaryDto = z.infer<typeof approveBoundarySchema>;
type RevisionCompareQueryDto = z.infer<typeof revisionCompareQuerySchema>;

@Controller()
export class BrainstormingController {
  constructor(@Inject(BrainstormingService) private readonly service: BrainstormingService) {}

  @Post('development-plans/:developmentPlanId/items/:itemId/brainstorming-sessions')
  startSession(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(startBrainstormingSessionSchema)) body: StartBrainstormingSessionDto,
  ) {
    return this.service.startSession({ development_plan_id: developmentPlanId, item_id: itemId, actor_id: body.actor_id });
  }

  @Post('brainstorming-sessions/:sessionId/answers')
  answerQuestion(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(answerQuestionSchema)) body: AnswerQuestionDto,
  ) {
    return this.service.answerQuestion(sessionId, body);
  }

  @Post('brainstorming-sessions/:sessionId/decisions')
  recordDecision(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(recordDecisionSchema)) body: RecordDecisionDto,
  ) {
    return this.service.recordDecision(sessionId, body);
  }

  @Post('brainstorming-sessions/:sessionId/approve-boundary')
  approveBoundary(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(approveBoundarySchema)) body: ApproveBoundaryDto,
  ) {
    return this.service.approveBoundary(sessionId, body);
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
