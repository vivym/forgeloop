import { Body, Controller, Headers, Inject, Param, Post } from '@nestjs/common';
import { productObjectRefSchema } from '@forgeloop/contracts';
import { z } from 'zod';

import { actorContextFromHeaders } from '../auth/actor-context';
import { actorCommandSchema } from '../delivery/dto';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { ExecutionsService } from './executions.service';

const nonEmptyString = z.string().trim().min(1);
const productEvidenceRefsSchema = z.array(productObjectRefSchema);

const readyForCodeReviewCommandSchema = actorCommandSchema
  .extend({
    summary: nonEmptyString,
    changed_surfaces: z.array(nonEmptyString).min(1),
    verification_evidence_refs: productEvidenceRefsSchema.min(1),
  })
  .strict();
type ReadyForCodeReviewCommandDto = z.infer<typeof readyForCodeReviewCommandSchema>;

const reviewDecisionCommandSchema = actorCommandSchema
  .extend({
    rationale: nonEmptyString,
  })
  .strict();
type ReviewDecisionCommandDto = z.infer<typeof reviewDecisionCommandSchema>;

const auditedExceptionCommandSchema = actorCommandSchema
  .extend({
    reason: nonEmptyString,
    risk: z.enum(['low', 'medium', 'high', 'critical']),
    rollback_plan: nonEmptyString,
  })
  .strict();
type AuditedExceptionCommandDto = z.infer<typeof auditedExceptionCommandSchema>;

const createQaHandoffCommandSchema = actorCommandSchema
  .extend({
    acceptance_criteria: z.array(nonEmptyString).min(1),
    test_strategy: nonEmptyString,
    verification_evidence_refs: productEvidenceRefsSchema.optional(),
    known_risks: z.array(nonEmptyString).default([]),
  })
  .strict();
type CreateQaHandoffCommandDto = z.infer<typeof createQaHandoffCommandSchema>;

const qaBlockCommandSchema = actorCommandSchema
  .extend({
    rationale: nonEmptyString,
  })
  .strict();
type QaBlockCommandDto = z.infer<typeof qaBlockCommandSchema>;

const qaAcceptCommandSchema = actorCommandSchema
  .extend({
    rationale: nonEmptyString,
    verification_evidence_refs: productEvidenceRefsSchema.min(1),
  })
  .strict();
type QaAcceptCommandDto = z.infer<typeof qaAcceptCommandSchema>;

@Controller()
export class ExecutionsController {
  constructor(@Inject(ExecutionsService) private readonly executionsService: ExecutionsService) {}

  @Post('executions/:executionId/continue')
  continueExecution(
    @Param('executionId') executionId: string,
    @Body(new ZodValidationPipe(actorCommandSchema)) body: z.infer<typeof actorCommandSchema>,
  ) {
    return this.executionsService.continueExecution(executionId, body);
  }

  @Post('executions/:executionId/interrupt')
  interruptExecution(
    @Param('executionId') executionId: string,
    @Body(new ZodValidationPipe(actorCommandSchema)) body: z.infer<typeof actorCommandSchema>,
  ) {
    return this.executionsService.interruptExecution(executionId, body);
  }

  @Post('executions/:executionId/ready-for-code-review')
  markReadyForCodeReview(
    @Param('executionId') executionId: string,
    @Body(new ZodValidationPipe(readyForCodeReviewCommandSchema)) body: ReadyForCodeReviewCommandDto,
  ) {
    return this.executionsService.markReadyForCodeReview(executionId, body);
  }

  @Post('code-review-handoffs/:handoffId/approve')
  approveCodeReview(
    @Param('handoffId') handoffId: string,
    @Body(new ZodValidationPipe(reviewDecisionCommandSchema)) body: ReviewDecisionCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.executionsService.approveCodeReview(handoffId, body, actorContextFromHeaders(headers));
  }

  @Post('code-review-handoffs/:handoffId/request-changes')
  requestCodeReviewChanges(
    @Param('handoffId') handoffId: string,
    @Body(new ZodValidationPipe(reviewDecisionCommandSchema)) body: ReviewDecisionCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.executionsService.requestCodeReviewChanges(handoffId, body, actorContextFromHeaders(headers));
  }

  @Post('code-review-handoffs/:handoffId/audited-exception')
  recordAuditedException(
    @Param('handoffId') handoffId: string,
    @Body(new ZodValidationPipe(auditedExceptionCommandSchema)) body: AuditedExceptionCommandDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.executionsService.recordCodeReviewAuditedException(handoffId, body, actorContextFromHeaders(headers));
  }

  @Post('code-review-handoffs/:handoffId/qa-handoff')
  createQaHandoff(
    @Param('handoffId') handoffId: string,
    @Body(new ZodValidationPipe(createQaHandoffCommandSchema)) body: CreateQaHandoffCommandDto,
  ) {
    return this.executionsService.createQaHandoff(handoffId, body);
  }

  @Post('qa-handoffs/:qaHandoffId/block')
  blockQaHandoff(
    @Param('qaHandoffId') qaHandoffId: string,
    @Body(new ZodValidationPipe(qaBlockCommandSchema)) body: QaBlockCommandDto,
  ) {
    return this.executionsService.blockQaHandoff(qaHandoffId, body);
  }

  @Post('qa-handoffs/:qaHandoffId/accept')
  acceptQaHandoff(
    @Param('qaHandoffId') qaHandoffId: string,
    @Body(new ZodValidationPipe(qaAcceptCommandSchema)) body: QaAcceptCommandDto,
  ) {
    return this.executionsService.acceptQaHandoff(qaHandoffId, body);
  }
}
