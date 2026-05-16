import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
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

import { actorContextFromHeaders } from '../auth/actor-context';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { ReleaseService } from './release.service';

@Controller('releases')
export class ReleaseController {
  constructor(private readonly releaseService: ReleaseService) {}

  @Post()
  createRelease(
    @Body(new ZodValidationPipe(createReleaseRequestSchema)) body: CreateReleaseRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.releaseService.createRelease(body, actorContextFromHeaders(headers));
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
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.releaseService.patchRelease(releaseId, body, actorContextFromHeaders(headers));
  }

  @Post(':releaseId/work-items/:workItemId')
  linkWorkItem(
    @Param('releaseId') releaseId: string,
    @Param('workItemId') workItemId: string,
    @Body(new ZodValidationPipe(linkReleaseObjectRequestSchema)) body: LinkReleaseObjectRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.releaseService.linkWorkItem(releaseId, workItemId, body, actorContextFromHeaders(headers));
  }

  @Delete(':releaseId/work-items/:workItemId')
  unlinkWorkItem(
    @Param('releaseId') releaseId: string,
    @Param('workItemId') workItemId: string,
    @Body(new ZodValidationPipe(unlinkReleaseObjectRequestSchema)) body: UnlinkReleaseObjectRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.releaseService.unlinkWorkItem(releaseId, workItemId, body, actorContextFromHeaders(headers));
  }

  @Post(':releaseId/execution-packages/:packageId')
  linkExecutionPackage(
    @Param('releaseId') releaseId: string,
    @Param('packageId') packageId: string,
    @Body(new ZodValidationPipe(linkReleaseObjectRequestSchema)) body: LinkReleaseObjectRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.releaseService.linkExecutionPackage(releaseId, packageId, body, actorContextFromHeaders(headers));
  }

  @Delete(':releaseId/execution-packages/:packageId')
  unlinkExecutionPackage(
    @Param('releaseId') releaseId: string,
    @Param('packageId') packageId: string,
    @Body(new ZodValidationPipe(unlinkReleaseObjectRequestSchema)) body: UnlinkReleaseObjectRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.releaseService.unlinkExecutionPackage(releaseId, packageId, body, actorContextFromHeaders(headers));
  }

  @Post(':releaseId/submit-for-approval')
  submitForApproval(
    @Param('releaseId') releaseId: string,
    @Body(new ZodValidationPipe(submitReleaseForApprovalRequestSchema)) body: SubmitReleaseForApprovalRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.releaseService.submitForApproval(releaseId, body, actorContextFromHeaders(headers));
  }

  @Post(':releaseId/approve')
  approveRelease(
    @Param('releaseId') releaseId: string,
    @Body(new ZodValidationPipe(approveReleaseRequestSchema)) body: ApproveReleaseRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.releaseService.approveRelease(releaseId, body, actorContextFromHeaders(headers));
  }

  @Post(':releaseId/override-approve')
  overrideApproveRelease(
    @Param('releaseId') releaseId: string,
    @Body(new ZodValidationPipe(overrideApproveReleaseRequestSchema)) body: OverrideApproveReleaseRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.releaseService.overrideApproveRelease(releaseId, body, actorContextFromHeaders(headers));
  }

  @Post(':releaseId/request-changes')
  requestChanges(
    @Param('releaseId') releaseId: string,
    @Body(new ZodValidationPipe(requestReleaseChangesRequestSchema)) body: RequestReleaseChangesRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.releaseService.requestChanges(releaseId, body, actorContextFromHeaders(headers));
  }

  @Post(':releaseId/evidences')
  createEvidence(
    @Param('releaseId') releaseId: string,
    @Body(new ZodValidationPipe(createReleaseEvidenceRequestSchema)) body: CreateReleaseEvidenceRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.releaseService.createEvidence(releaseId, body, actorContextFromHeaders(headers));
  }

  @Post(':releaseId/start-observing')
  startObserving(
    @Param('releaseId') releaseId: string,
    @Body(new ZodValidationPipe(startReleaseObservingRequestSchema)) body: StartReleaseObservingRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.releaseService.startObserving(releaseId, body, actorContextFromHeaders(headers));
  }

  @Post(':releaseId/close')
  closeRelease(
    @Param('releaseId') releaseId: string,
    @Body(new ZodValidationPipe(closeReleaseRequestSchema)) body: CloseReleaseRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.releaseService.closeRelease(releaseId, body, actorContextFromHeaders(headers));
  }
}
