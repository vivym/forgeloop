import { Controller, Get, Param, Query } from '@nestjs/common';

import { ReviewEvidenceService } from './review-evidence.service';

@Controller()
export class WorkItemEvidenceController {
  constructor(private readonly reviewEvidenceService: ReviewEvidenceService) {}

  @Get('work-items/:workItemId/evidence-chain')
  getWorkItemEvidenceChain(@Param('workItemId') workItemId: string, @Query('review_packet_id') reviewPacketId?: string) {
    return this.reviewEvidenceService.evidenceChain(workItemId, reviewPacketId);
  }
}
