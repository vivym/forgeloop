import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import { TrustedAutomationActorGuard } from '../automation/trusted-automation-actor.guard';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import {
  codexRuntimeStatusQuerySchema,
  createCodexCredentialSchema,
  createCodexLaunchLeaseSchema,
  createCodexRuntimeProfileSchema,
  createCodexWorkerBootstrapTokenSchema,
  heartbeatCodexWorkerSchema,
  materializeCodexLaunchLeaseSchema,
  recoverStaleCodexWorkersSchema,
  registerCodexWorkerSchema,
  revokeCodexLaunchLeaseSchema,
  terminalizeCodexLaunchLeaseSchema,
  type CodexRuntimeStatusQuery,
  type CreateCodexCredentialDto,
  type CreateCodexLaunchLeaseDto,
  type CreateCodexRuntimeProfileDto,
  type CreateCodexWorkerBootstrapTokenDto,
  type HeartbeatCodexWorkerDto,
  type MaterializeCodexLaunchLeaseDto,
  type RecoverStaleCodexWorkersDto,
  type RegisterCodexWorkerDto,
  type RevokeCodexLaunchLeaseDto,
  type TerminalizeCodexLaunchLeaseDto,
} from './codex-runtime.dto';
import { CodexRuntimeService } from './codex-runtime.service';
import { TrustedCodexRuntimeSetupGuard } from './trusted-codex-runtime-setup.guard';

@Controller()
export class CodexRuntimeController {
  constructor(private readonly service: CodexRuntimeService) {}

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
