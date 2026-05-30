import { Buffer } from 'node:buffer';

import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { codexCanonicalDigest, codexCredentialPayloadDigest } from '@forgeloop/domain';
import { z } from 'zod';

import { TrustedAutomationActorGuard } from '../automation/trusted-automation-actor.guard';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import {
  codexRuntimeStatusQuerySchema,
  acceptCodexRuntimeJobSchema,
  appendCodexRuntimeJobEventSchema,
  cancelCodexRuntimeJobSchema,
  claimCodexRuntimeJobEnvelopeSchema,
  codexRuntimeWorkerQuerySchema,
  createCodexCredentialSchema,
  createCodexLaunchLeaseSchema,
  createCodexRuntimeJobArtifactUploadMetadataSchema,
  createCodexRuntimeJobSchema,
  createCodexRuntimeProfileSchema,
  createCodexWorkerBootstrapTokenSchema,
  heartbeatCodexWorkerSchema,
  importCodexCredentialSchema,
  importCodexRuntimeProfileSchema,
  importLocalCodexSchema,
  materializeCodexRuntimeJobSchema,
  materializeCodexLaunchLeaseSchema,
  pollCodexRuntimeJobsSchema,
  recoverStaleCodexRuntimeJobsSchema,
  recoverStaleCodexWorkersSchema,
  registerCodexWorkerSchema,
  renewAutomationActionRunClaimSchema,
  revokeCodexLaunchLeaseSchema,
  startCodexRuntimeJobSchema,
  terminalizeCodexRuntimeJobSchema,
  terminalizeCodexLaunchLeaseSchema,
  refreshCodexWorkerSessionSchema,
  type AcceptCodexRuntimeJobDto,
  type AppendCodexRuntimeJobEventDto,
  type CancelCodexRuntimeJobDto,
  type ClaimCodexRuntimeJobEnvelopeDto,
  type CodexRuntimeWorkerQueryDto,
  type CodexRuntimeStatusQuery,
  type CreateCodexCredentialDto,
  type CreateCodexLaunchLeaseDto,
  type CreateCodexRuntimeJobArtifactDto,
  type CreateCodexRuntimeJobDto,
  type CreateCodexRuntimeProfileDto,
  type CreateCodexWorkerBootstrapTokenDto,
  type HeartbeatCodexWorkerDto,
  type ImportCodexCredentialDto,
  type ImportCodexRuntimeProfileDto,
  type ImportLocalCodexDto,
  type MaterializeCodexRuntimeJobDto,
  type MaterializeCodexLaunchLeaseDto,
  type PollCodexRuntimeJobsDto,
  type RecoverStaleCodexWorkersDto,
  type RecoverStaleCodexRuntimeJobsDto,
  type RegisterCodexWorkerDto,
  type RenewAutomationActionRunClaimDto,
  type RevokeCodexLaunchLeaseDto,
  type StartCodexRuntimeJobDto,
  type TerminalizeCodexRuntimeJobDto,
  type TerminalizeCodexLaunchLeaseDto,
  type RefreshCodexWorkerSessionDto,
} from './codex-runtime.dto';
import { CodexRuntimeService } from './codex-runtime.service';
import { TrustedCodexRuntimeSetupGuard } from './trusted-codex-runtime-setup.guard';

const withoutBodyDigest = <T extends { body_digest?: string }>(input: T): Omit<T, 'body_digest'> => {
  const { body_digest: _bodyDigest, ...body } = input;
  return body;
};

const assertWorkerBodyDigest = (input: { body_digest: string }): void => {
  const expected = codexCanonicalDigest(withoutBodyDigest(input));
  if (input.body_digest !== expected) {
    throw new BadRequestException('Codex worker request body digest was rejected');
  }
};

type RuntimeArtifactUploadRequest = {
  rawBody?: Buffer;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
};

const runtimeArtifactMetadataHeaderName = 'x-forgeloop-runtime-artifact-metadata';

const singleHeaderValue = (headers: RuntimeArtifactUploadRequest['headers'], name: string): string | undefined => {
  const values = Object.entries(headers)
    .filter(([headerName, value]) => headerName.toLowerCase() === name && value !== undefined)
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]));
  if (values.length > 1) {
    throw new BadRequestException('Codex runtime job artifact upload metadata was rejected');
  }
  return values[0]?.trim();
};

export const parseRuntimeArtifactUploadRequest = (
  request: RuntimeArtifactUploadRequest,
  params: { workerId: string; jobId: string },
): CreateCodexRuntimeJobArtifactDto => {
  const contentType = singleHeaderValue(request.headers, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  const bytes = request.rawBody ?? (Buffer.isBuffer(request.body) ? request.body : undefined);
  if (contentType !== 'application/octet-stream' || bytes === undefined || bytes.byteLength === 0) {
    throw new BadRequestException('Codex runtime job artifact upload requires application/octet-stream bytes');
  }

  const encodedMetadata = singleHeaderValue(request.headers, runtimeArtifactMetadataHeaderName);
  if (encodedMetadata === undefined || encodedMetadata.length === 0) {
    throw new BadRequestException('Codex runtime job artifact upload metadata is required');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encodedMetadata, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('Codex runtime job artifact upload metadata must be base64url JSON');
  }

  const parsed = createCodexRuntimeJobArtifactUploadMetadataSchema
    .extend({ body_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) })
    .strict()
    .safeParse(decoded);
  if (!parsed.success) {
    throw new BadRequestException('Codex runtime job artifact upload metadata was rejected');
  }

  return {
    proof_path: `/internal/codex-workers/${params.workerId}/runtime-jobs/${params.jobId}/artifacts`,
    metadata: parsed.data,
    bytes,
  };
};

@Controller()
export class CodexRuntimeController {
  constructor(@Inject(CodexRuntimeService) private readonly service: CodexRuntimeService) {}

  @Post('/internal/codex-runtime/profiles')
  @UseGuards(TrustedCodexRuntimeSetupGuard)
  createProfile(@Body(new ZodValidationPipe(createCodexRuntimeProfileSchema)) body: CreateCodexRuntimeProfileDto) {
    return this.service.createProfile(body);
  }

  @Post('/internal/codex-runtime/credentials')
  @UseGuards(TrustedCodexRuntimeSetupGuard)
  createCredential(@Body(new ZodValidationPipe(createCodexCredentialSchema)) body: CreateCodexCredentialDto) {
    return this.service.createCredential(body);
  }

  @Post('/internal/codex-runtime/import-profile')
  @UseGuards(TrustedCodexRuntimeSetupGuard)
  importProfile(@Body(new ZodValidationPipe(importCodexRuntimeProfileSchema)) body: ImportCodexRuntimeProfileDto) {
    return this.service.importProfile(body);
  }

  @Post('/internal/codex-runtime/import-credential')
  @UseGuards(TrustedCodexRuntimeSetupGuard)
  importCredential(@Body(new ZodValidationPipe(importCodexCredentialSchema)) body: ImportCodexCredentialDto) {
    return this.service.importCredential(body);
  }

  @Post('/internal/codex-runtime/import-local-codex')
  @UseGuards(TrustedCodexRuntimeSetupGuard)
  importLocalCodex(@Body(new ZodValidationPipe(importLocalCodexSchema)) body: ImportLocalCodexDto) {
    return this.service.importLocalCodex(body);
  }

  @Post('/internal/codex-runtime/worker-bootstrap-tokens')
  @UseGuards(TrustedCodexRuntimeSetupGuard)
  createWorkerBootstrapToken(
    @Body(new ZodValidationPipe(createCodexWorkerBootstrapTokenSchema)) body: CreateCodexWorkerBootstrapTokenDto,
  ) {
    return this.service.createWorkerBootstrapToken(body);
  }

  @Get('/internal/codex-runtime/status')
  @UseGuards(TrustedAutomationActorGuard)
  getStatus(@Query(new ZodValidationPipe(codexRuntimeStatusQuerySchema)) query: CodexRuntimeStatusQuery) {
    return this.service.getStatus(query);
  }

  @Post('/internal/codex-runtime/recover-stale-workers')
  @UseGuards(TrustedAutomationActorGuard)
  recoverStaleWorkers(@Body(new ZodValidationPipe(recoverStaleCodexWorkersSchema)) body: RecoverStaleCodexWorkersDto) {
    return this.service.recoverStaleWorkers(body);
  }

  @Post('/internal/codex-runtime/runtime-jobs')
  @UseGuards(TrustedAutomationActorGuard)
  createRuntimeJob(@Body(new ZodValidationPipe(createCodexRuntimeJobSchema)) body: CreateCodexRuntimeJobDto) {
    return this.service.createRuntimeJob(body);
  }

  @Get('/internal/codex-runtime/runtime-jobs/:jobId')
  @UseGuards(TrustedAutomationActorGuard)
  getRuntimeJob(@Param('jobId') jobId: string) {
    return this.service.getRuntimeJob(jobId);
  }

  @Post('/internal/codex-runtime/runtime-jobs/:jobId/cancel')
  @UseGuards(TrustedAutomationActorGuard)
  cancelRuntimeJob(
    @Param('jobId') jobId: string,
    @Body(new ZodValidationPipe(cancelCodexRuntimeJobSchema)) body: CancelCodexRuntimeJobDto,
  ) {
    return this.service.cancelRuntimeJob(jobId, body);
  }

  @Post('/internal/codex-runtime/runtime-jobs/recover-stale')
  @UseGuards(TrustedAutomationActorGuard)
  recoverStaleRuntimeJobs(
    @Body(new ZodValidationPipe(recoverStaleCodexRuntimeJobsSchema)) body: RecoverStaleCodexRuntimeJobsDto,
  ) {
    return this.service.recoverStaleRuntimeJobs(body);
  }

  @Get('/internal/codex-launch-leases/:leaseId/status')
  @UseGuards(TrustedAutomationActorGuard)
  getLaunchLeasePublicStatus(@Param('leaseId') leaseId: string) {
    return this.service.getLaunchLeasePublicStatus(leaseId);
  }

  @Post('/internal/automation/action-runs/:actionRunId/claim/renew')
  @UseGuards(TrustedAutomationActorGuard)
  renewAutomationActionRunClaim(
    @Param('actionRunId') actionRunId: string,
    @Body(new ZodValidationPipe(renewAutomationActionRunClaimSchema)) body: RenewAutomationActionRunClaimDto,
  ) {
    return this.service.renewAutomationActionRunClaim(actionRunId, body);
  }

  @Post('/internal/codex-workers/register')
  registerWorker(@Body(new ZodValidationPipe(registerCodexWorkerSchema)) body: RegisterCodexWorkerDto) {
    return this.service.registerWorker(body);
  }

  @Post('/internal/codex-workers/:workerId/heartbeat')
  heartbeatWorker(
    @Param('workerId') workerId: string,
    @Body(new ZodValidationPipe(heartbeatCodexWorkerSchema)) body: HeartbeatCodexWorkerDto,
  ) {
    return this.service.heartbeatWorker(workerId, body);
  }

  @Post('/internal/codex-workers/:workerId/session/refresh')
  refreshWorkerSession(
    @Param('workerId') workerId: string,
    @Body(new ZodValidationPipe(refreshCodexWorkerSessionSchema)) body: RefreshCodexWorkerSessionDto,
  ) {
    return this.service.refreshWorkerSession(workerId, body);
  }

  @Post('/internal/codex-workers/:workerId/runtime-jobs/poll')
  pollRuntimeJobs(
    @Param('workerId') workerId: string,
    @Body(new ZodValidationPipe(pollCodexRuntimeJobsSchema)) body: PollCodexRuntimeJobsDto,
  ) {
    return this.service.pollRuntimeJobs(workerId, body);
  }

  @Post('/internal/codex-workers/:workerId/runtime-jobs/:jobId/accepted')
  acceptRuntimeJob(
    @Param('workerId') workerId: string,
    @Param('jobId') jobId: string,
    @Body(new ZodValidationPipe(acceptCodexRuntimeJobSchema)) body: AcceptCodexRuntimeJobDto,
  ) {
    return this.service.acceptRuntimeJob(workerId, jobId, body);
  }

  @Post('/internal/codex-workers/:workerId/runtime-jobs/:jobId/envelope/claim')
  claimRuntimeJobEnvelope(
    @Param('workerId') workerId: string,
    @Param('jobId') jobId: string,
    @Body(new ZodValidationPipe(claimCodexRuntimeJobEnvelopeSchema)) body: ClaimCodexRuntimeJobEnvelopeDto,
  ) {
    return this.service.claimRuntimeJobEnvelope(workerId, jobId, body);
  }

  @Get('/internal/codex-workers/:workerId/runtime-jobs/:jobId/workload')
  getRuntimeJobWorkload(
    @Param('workerId') workerId: string,
    @Param('jobId') jobId: string,
    @Query(new ZodValidationPipe(codexRuntimeWorkerQuerySchema)) query: CodexRuntimeWorkerQueryDto,
  ) {
    return this.service.getRuntimeJobWorkload(workerId, jobId, query);
  }

  @Post('/internal/codex-workers/:workerId/runtime-jobs/:jobId/materialize')
  materializeRuntimeJob(
    @Param('workerId') workerId: string,
    @Param('jobId') jobId: string,
    @Body(new ZodValidationPipe(materializeCodexRuntimeJobSchema)) body: MaterializeCodexRuntimeJobDto,
  ) {
    assertWorkerBodyDigest(body);
    const { launch_token: launchToken, ...scrubbedBody } = body;
    return this.service.materializeRuntimeJob(workerId, jobId, {
      ...scrubbedBody,
      launch_token_hash: codexCredentialPayloadDigest(launchToken),
    });
  }

  @Post('/internal/codex-workers/:workerId/runtime-jobs/:jobId/started')
  startRuntimeJob(
    @Param('workerId') workerId: string,
    @Param('jobId') jobId: string,
    @Body(new ZodValidationPipe(startCodexRuntimeJobSchema)) body: StartCodexRuntimeJobDto,
  ) {
    return this.service.startRuntimeJob(workerId, jobId, body);
  }

  @Post('/internal/codex-workers/:workerId/runtime-jobs/:jobId/events')
  appendRuntimeJobEvent(
    @Param('workerId') workerId: string,
    @Param('jobId') jobId: string,
    @Body(new ZodValidationPipe(appendCodexRuntimeJobEventSchema)) body: AppendCodexRuntimeJobEventDto,
  ) {
    return this.service.appendRuntimeJobEvent(workerId, jobId, body);
  }

  @Post('/internal/codex-workers/:workerId/runtime-jobs/:jobId/artifacts')
  createRuntimeJobArtifact(
    @Param('workerId') workerId: string,
    @Param('jobId') jobId: string,
    @Req() request: RuntimeArtifactUploadRequest,
  ) {
    const parsed = parseRuntimeArtifactUploadRequest(request, { workerId, jobId });
    return this.service.createRuntimeJobArtifact(workerId, jobId, parsed);
  }

  @Get('/internal/codex-workers/:workerId/runtime-jobs/:jobId/workspace-bundle/:bundleId')
  async downloadWorkspaceBundle(
    @Param('workerId') workerId: string,
    @Param('jobId') jobId: string,
    @Param('bundleId') bundleId: string,
    @Query(new ZodValidationPipe(codexRuntimeWorkerQuerySchema)) query: CodexRuntimeWorkerQueryDto,
    @Res({ passthrough: true }) response: { setHeader: (name: string, value: string) => void },
  ) {
    const download = await this.service.downloadWorkspaceBundle(workerId, jobId, bundleId, query);
    response.setHeader('content-type', download.content_type);
    response.setHeader('content-length', String(download.size_bytes));
    response.setHeader('x-forgeloop-workspace-bundle-digest', download.archive_digest);
    response.setHeader('x-forgeloop-workspace-bundle-manifest-digest', download.manifest_digest);
    return new StreamableFile(Buffer.from(download.archive_bytes_base64, 'base64'));
  }

  @Get('/internal/codex-workers/:workerId/runtime-jobs/:jobId/control')
  getRuntimeJobControl(
    @Param('workerId') workerId: string,
    @Param('jobId') jobId: string,
    @Query(new ZodValidationPipe(codexRuntimeWorkerQuerySchema)) query: CodexRuntimeWorkerQueryDto,
  ) {
    return this.service.getRuntimeJobControl(workerId, jobId, query);
  }

  @Post('/internal/codex-workers/:workerId/runtime-jobs/:jobId/terminal')
  terminalizeRuntimeJob(
    @Param('workerId') workerId: string,
    @Param('jobId') jobId: string,
    @Body(new ZodValidationPipe(terminalizeCodexRuntimeJobSchema)) body: TerminalizeCodexRuntimeJobDto,
  ) {
    return this.service.terminalizeRuntimeJob(workerId, jobId, body);
  }

  @Post('/internal/codex-launch-leases')
  @UseGuards(TrustedAutomationActorGuard)
  createLaunchLease(@Body(new ZodValidationPipe(createCodexLaunchLeaseSchema)) body: CreateCodexLaunchLeaseDto) {
    return this.service.createLaunchLease(body);
  }

  @Post('/internal/codex-launch-leases/:leaseId/revoke')
  @UseGuards(TrustedAutomationActorGuard)
  revokeLaunchLease(
    @Param('leaseId') leaseId: string,
    @Body(new ZodValidationPipe(revokeCodexLaunchLeaseSchema)) body: RevokeCodexLaunchLeaseDto,
  ) {
    return this.service.revokeLaunchLease(leaseId, body);
  }

  @Post('/internal/codex-workers/:workerId/launch-leases/:leaseId/materialize')
  materializeLaunchLease(
    @Param('workerId') workerId: string,
    @Param('leaseId') leaseId: string,
    @Body(new ZodValidationPipe(materializeCodexLaunchLeaseSchema)) body: MaterializeCodexLaunchLeaseDto,
  ) {
    return this.service.materializeLaunchLease(workerId, leaseId, body);
  }

  @Post('/internal/codex-workers/:workerId/launch-leases/:leaseId/terminal')
  terminalizeLaunchLease(
    @Param('workerId') workerId: string,
    @Param('leaseId') leaseId: string,
    @Body(new ZodValidationPipe(terminalizeCodexLaunchLeaseSchema)) body: TerminalizeCodexLaunchLeaseDto,
  ) {
    return this.service.terminalizeLaunchLease(workerId, leaseId, body);
  }
}
