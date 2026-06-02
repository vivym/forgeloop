import { Body, Controller, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';

import { TrustedAutomationActorGuard } from '../automation/trusted-automation-actor.guard';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { CodexSessionLeaseService } from './codex-session-lease.service';
import {
  claimCodexSessionLeaseSchema,
  createCodexRuntimeCapsuleSchema,
  renewCodexSessionLeaseSchema,
  terminalizeCodexSessionTurnSchema,
  type ClaimCodexSessionLeaseDto,
  type CreateCodexRuntimeCapsuleDto,
  type RenewCodexSessionLeaseDto,
  type TerminalizeCodexSessionTurnDto,
} from './plan-item-workflow.dto';

type AutomationRequest = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller('internal/codex-sessions')
@UseGuards(TrustedAutomationActorGuard)
export class InternalCodexSessionController {
  constructor(@Inject(CodexSessionLeaseService) private readonly service: CodexSessionLeaseService) {}

  @Post(':sessionId/leases/claim')
  claim(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(claimCodexSessionLeaseSchema)) body: ClaimCodexSessionLeaseDto,
  ) {
    return this.service.claim(sessionId, body);
  }

  @Post(':sessionId/leases/:leaseId/renew')
  renew(
    @Param('sessionId') sessionId: string,
    @Param('leaseId') leaseId: string,
    @Body(new ZodValidationPipe(renewCodexSessionLeaseSchema)) body: RenewCodexSessionLeaseDto,
  ) {
    return this.service.renew(sessionId, leaseId, body);
  }

  @Post(':sessionId/runtime-capsules')
  createRuntimeCapsule(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(createCodexRuntimeCapsuleSchema)) body: CreateCodexRuntimeCapsuleDto,
  ) {
    return this.service.createRuntimeCapsule(sessionId, body);
  }

  @Post(':sessionId/turns/:turnId/terminalize')
  terminalize(
    @Param('sessionId') sessionId: string,
    @Param('turnId') turnId: string,
    @Req() request: AutomationRequest,
    @Body(new ZodValidationPipe(terminalizeCodexSessionTurnSchema)) body: TerminalizeCodexSessionTurnDto,
  ) {
    return this.service.terminalize(sessionId, turnId, body, request);
  }
}
