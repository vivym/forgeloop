import { Body, Controller, Get, Headers, Inject, Param, Post, Query } from '@nestjs/common';

import { actorContextFromHeaders } from '../auth/actor-context';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import {
  recoverSessionRouteRequestSchema,
  scavengeSessionOperationsRequestSchema,
  type RecoverSessionRequestDto,
  type ScavengeSessionOperationsRequestDto,
} from './session-operations.dto';
import { SessionOperationsService } from './session-operations.service';

@Controller()
export class SessionOperationsController {
  constructor(@Inject(SessionOperationsService) private readonly service: SessionOperationsService) {}

  @Get('session-operations/health')
  listHealth(@Headers() headers: Record<string, string | string[] | undefined>, @Query() query: Record<string, string | undefined>) {
    return this.service.listHealth(query, actorContextFromHeaders(headers));
  }

  @Get('session-operations/:sessionId/audit')
  listAudit(@Param('sessionId') sessionId: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    return this.service.listAudit(sessionId, actorContextFromHeaders(headers));
  }

  @Post('session-operations/:sessionId/recover')
  recover(
    @Param('sessionId') sessionId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(recoverSessionRouteRequestSchema)) body: RecoverSessionRequestDto,
  ) {
    return this.service.recover(sessionId, body, actorContextFromHeaders(headers));
  }

  @Post('session-operations/scavenge')
  scavenge(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(scavengeSessionOperationsRequestSchema)) body: ScavengeSessionOperationsRequestDto,
  ) {
    return this.service.scavenge(body, actorContextFromHeaders(headers));
  }

  @Get('plan-items/:planItemId/session-diagnostics')
  getPlanItemDiagnostics(
    @Param('planItemId') planItemId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.getPlanItemDiagnostics(planItemId, actorContextFromHeaders(headers));
  }
}
