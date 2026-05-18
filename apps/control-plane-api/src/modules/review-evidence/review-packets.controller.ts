import { Body, Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';

import { actorContextFromHeaders } from '../auth/actor-context';
import { reviewDecisionSchema, type ReviewDecisionDto } from '../delivery/dto';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { ReviewEvidenceService } from './review-evidence.service';

@Controller()
export class ReviewPacketsController {
  constructor(@Inject(ReviewEvidenceService) private readonly reviewEvidenceService: ReviewEvidenceService) {}

  @Get('review-packets/:reviewPacketId')
  getReviewPacket(@Param('reviewPacketId') reviewPacketId: string) {
    return this.reviewEvidenceService.getReviewPacket(reviewPacketId);
  }

  @Post('review-packets/:reviewPacketId/approve')
  approveReviewPacket(
    @Param('reviewPacketId') reviewPacketId: string,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.reviewEvidenceService.approveReviewPacket(reviewPacketId, body, actorContextFromHeaders(headers));
  }

  @Post('review-packets/:reviewPacketId/request-changes')
  requestReviewChanges(
    @Param('reviewPacketId') reviewPacketId: string,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.reviewEvidenceService.requestReviewChanges(reviewPacketId, body, actorContextFromHeaders(headers));
  }
}
