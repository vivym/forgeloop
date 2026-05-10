import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  approveReleaseRequestSchema,
  closeReleaseRequestSchema,
  createReleaseEvidenceRequestSchema,
  createReleaseRequestSchema,
  linkReleaseObjectRequestSchema,
  overrideApproveReleaseRequestSchema,
  patchReleaseRequestSchema,
  releaseListQuerySchema,
  releaseResourceQuerySchema,
  requestReleaseChangesRequestSchema,
  startReleaseObservingRequestSchema,
  submitReleaseForApprovalRequestSchema,
  unlinkReleaseObjectRequestSchema,
  type ApproveReleaseRequest,
  type CloseReleaseRequest,
  type CreateReleaseEvidenceRequest,
  type CreateReleaseRequest,
  type LinkReleaseObjectRequest,
  type OverrideApproveReleaseRequest,
  type PatchReleaseRequest,
  type ReleaseListQuery,
  type ReleaseResourceQuery,
  type RequestReleaseChangesRequest,
  type StartReleaseObservingRequest,
  type SubmitReleaseForApprovalRequest,
  type UnlinkReleaseObjectRequest,
} from '@forgeloop/contracts';

import { ZodValidationPipe } from '../../p0/zod-validation.pipe';
import { ReleaseService } from './release.service';

@Controller('releases')
export class ReleaseController {
  constructor(private readonly releaseService: ReleaseService) {}

  @Post()
  createRelease(@Body(new ZodValidationPipe(createReleaseRequestSchema)) body: CreateReleaseRequest) {
    return this.releaseService.createRelease(body);
  }

  @Get()
  listReleases(@Query(new ZodValidationPipe(releaseListQuerySchema)) query: ReleaseListQuery) {
    return this.releaseService.listReleases(query);
  }

  @Get(':releaseId')
  getRelease(@Param('releaseId') releaseId: string, @Query(new ZodValidationPipe(releaseResourceQuerySchema)) query: ReleaseResourceQuery) {
    return this.releaseService.getRelease(releaseId, query);
  }

  @Patch(':releaseId')
  patchRelease(
    @Param('releaseId') releaseId: string,
    @Body(new ZodValidationPipe(patchReleaseRequestSchema)) body: PatchReleaseRequest,
  ) {
    return this.releaseService.patchRelease(releaseId, body);
  }

  @Post(':releaseId/work-items/:workItemId')
  linkWorkItem(
    @Param('releaseId') releaseId: string,
    @Param('workItemId') workItemId: string,
    @Body(new ZodValidationPipe(linkReleaseObjectRequestSchema)) body: LinkReleaseObjectRequest,
  ) {
    return this.releaseService.linkWorkItem(releaseId, workItemId, body);
  }

  @Delete(':releaseId/work-items/:workItemId')
  unlinkWorkItem(
    @Param('releaseId') releaseId: string,
    @Param('workItemId') workItemId: string,
    @Body(new ZodValidationPipe(unlinkReleaseObjectRequestSchema)) body: UnlinkReleaseObjectRequest,
  ) {
    return this.releaseService.unlinkWorkItem(releaseId, workItemId, body);
  }

  @Post(':releaseId/execution-packages/:packageId')
  linkExecutionPackage(
    @Param('releaseId') releaseId: string,
    @Param('packageId') packageId: string,
    @Body(new ZodValidationPipe(linkReleaseObjectRequestSchema)) body: LinkReleaseObjectRequest,
  ) {
    return this.releaseService.linkExecutionPackage(releaseId, packageId, body);
  }

  @Delete(':releaseId/execution-packages/:packageId')
  unlinkExecutionPackage(
    @Param('releaseId') releaseId: string,
    @Param('packageId') packageId: string,
    @Body(new ZodValidationPipe(unlinkReleaseObjectRequestSchema)) body: UnlinkReleaseObjectRequest,
  ) {
    return this.releaseService.unlinkExecutionPackage(releaseId, packageId, body);
  }

  @Post(':releaseId/submit-for-approval')
  submitForApproval(
    @Param('releaseId') releaseId: string,
    @Body(new ZodValidationPipe(submitReleaseForApprovalRequestSchema)) body: SubmitReleaseForApprovalRequest,
  ) {
    return this.releaseService.submitForApproval(releaseId, body);
  }

  @Post(':releaseId/approve')
  approveRelease(
    @Param('releaseId') releaseId: string,
    @Body(new ZodValidationPipe(approveReleaseRequestSchema)) body: ApproveReleaseRequest,
  ) {
    return this.releaseService.approveRelease(releaseId, body);
  }

  @Post(':releaseId/override-approve')
  overrideApproveRelease(
    @Param('releaseId') releaseId: string,
    @Body(new ZodValidationPipe(overrideApproveReleaseRequestSchema)) body: OverrideApproveReleaseRequest,
  ) {
    return this.releaseService.overrideApproveRelease(releaseId, body);
  }

  @Post(':releaseId/request-changes')
  requestChanges(
    @Param('releaseId') releaseId: string,
    @Body(new ZodValidationPipe(requestReleaseChangesRequestSchema)) body: RequestReleaseChangesRequest,
  ) {
    return this.releaseService.requestChanges(releaseId, body);
  }

  @Post(':releaseId/evidences')
  createEvidence(
    @Param('releaseId') releaseId: string,
    @Body(new ZodValidationPipe(createReleaseEvidenceRequestSchema)) body: CreateReleaseEvidenceRequest,
  ) {
    return this.releaseService.createEvidence(releaseId, body);
  }

  @Post(':releaseId/start-observing')
  startObserving(
    @Param('releaseId') releaseId: string,
    @Body(new ZodValidationPipe(startReleaseObservingRequestSchema)) body: StartReleaseObservingRequest,
  ) {
    return this.releaseService.startObserving(releaseId, body);
  }

  @Post(':releaseId/close')
  closeRelease(
    @Param('releaseId') releaseId: string,
    @Body(new ZodValidationPipe(closeReleaseRequestSchema)) body: CloseReleaseRequest,
  ) {
    return this.releaseService.closeRelease(releaseId, body);
  }
}
