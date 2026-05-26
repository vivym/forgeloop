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

const startBoundaryBrainstormingSchema = z
  .object({
    actor_id: nonEmptyString,
    leader_actor_id: nonEmptyString.optional(),
    leader_delegate_actor_ids: z.array(nonEmptyString).optional(),
    initial_leader_context_markdown: nonEmptyString.optional(),
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
    waived_question_id: nonEmptyString.optional(),
    actor_id: nonEmptyString,
  })
  .strict();

const continueBoundaryBrainstormingSchema = z
  .object({
    actor_id: nonEmptyString,
    leader_input_markdown: nonEmptyString.optional(),
  })
  .strict();

const approveBoundarySummaryRevisionSchema = z
  .object({
    actor_id: nonEmptyString,
    final_decision: nonEmptyString.optional(),
  })
  .strict();

const requestBoundarySummaryChangesSchema = z
  .object({
    actor_id: nonEmptyString,
    feedback_markdown: nonEmptyString,
    rationale: nonEmptyString.optional(),
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
type StartBoundaryBrainstormingDto = z.infer<typeof startBoundaryBrainstormingSchema>;
type AnswerQuestionDto = z.infer<typeof answerQuestionSchema>;
type RecordDecisionDto = z.infer<typeof recordDecisionSchema>;
type ContinueBoundaryBrainstormingDto = z.infer<typeof continueBoundaryBrainstormingSchema>;
type ApproveBoundaryDto = z.infer<typeof approveBoundarySchema>;
type ApproveBoundarySummaryRevisionDto = z.infer<typeof approveBoundarySummaryRevisionSchema>;
type RequestBoundarySummaryChangesDto = z.infer<typeof requestBoundarySummaryChangesSchema>;
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

  @Post('development-plans/:developmentPlanId/items/:itemId/boundary-brainstorming')
  startBoundaryBrainstorming(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(startBoundaryBrainstormingSchema)) body: StartBoundaryBrainstormingDto,
  ) {
    return this.service.startBoundaryBrainstorming({
      development_plan_id: developmentPlanId,
      item_id: itemId,
      actor_id: body.actor_id,
      leader_actor_id: body.leader_actor_id,
      leader_delegate_actor_ids: body.leader_delegate_actor_ids,
      initial_leader_context_markdown: body.initial_leader_context_markdown,
    });
  }

  @Post('development-plans/:developmentPlanId/items/:itemId/boundary-brainstorming/restart')
  restartBoundaryBrainstorming(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(startBoundaryBrainstormingSchema)) body: StartBoundaryBrainstormingDto,
  ) {
    return this.service.restartBoundaryBrainstorming({
      development_plan_id: developmentPlanId,
      item_id: itemId,
      actor_id: body.actor_id,
      leader_actor_id: body.leader_actor_id,
      leader_delegate_actor_ids: body.leader_delegate_actor_ids,
      initial_leader_context_markdown: body.initial_leader_context_markdown,
    });
  }

  @Post('brainstorming-sessions/:sessionId/answers')
  answerQuestion(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(answerQuestionSchema)) body: AnswerQuestionDto,
  ) {
    return this.service.answerQuestion(sessionId, body);
  }

  @Post('boundary-brainstorming-sessions/:sessionId/answers')
  answerBoundaryQuestion(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(answerQuestionSchema)) body: AnswerQuestionDto,
  ) {
    return this.service.answerQuestion(sessionId, body);
  }

  @Get('boundary-brainstorming-sessions/:sessionId')
  getBoundaryBrainstormingSession(@Param('sessionId') sessionId: string) {
    return this.service.getBoundaryBrainstormingSession(sessionId);
  }

  @Post('brainstorming-sessions/:sessionId/decisions')
  recordDecision(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(recordDecisionSchema)) body: RecordDecisionDto,
  ) {
    return this.service.recordDecision(sessionId, body);
  }

  @Post('boundary-brainstorming-sessions/:sessionId/decisions')
  recordBoundaryDecision(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(recordDecisionSchema)) body: RecordDecisionDto,
  ) {
    return this.service.recordDecision(sessionId, body);
  }

  @Post('boundary-brainstorming-sessions/:sessionId/continue')
  continueBoundaryBrainstorming(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(continueBoundaryBrainstormingSchema)) body: ContinueBoundaryBrainstormingDto,
  ) {
    return this.service.continueBoundaryBrainstorming(sessionId, body);
  }

  @Post('brainstorming-sessions/:sessionId/approve-boundary')
  approveBoundary(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(approveBoundarySchema)) body: ApproveBoundaryDto,
  ) {
    return this.service.approveBoundary(sessionId, body);
  }

  @Post('boundary-brainstorming-sessions/:sessionId/summary-revisions/:revisionId/approve')
  approveBoundarySummaryRevision(
    @Param('sessionId') sessionId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(approveBoundarySummaryRevisionSchema)) body: ApproveBoundarySummaryRevisionDto,
  ) {
    return this.service.approveBoundarySummaryRevision(sessionId, revisionId, body);
  }

  @Post('boundary-brainstorming-sessions/:sessionId/summary-revisions/:revisionId/request-changes')
  requestBoundarySummaryChanges(
    @Param('sessionId') sessionId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(requestBoundarySummaryChangesSchema)) body: RequestBoundarySummaryChangesDto,
  ) {
    return this.service.requestBoundarySummaryChanges(sessionId, revisionId, body);
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
