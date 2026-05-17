import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';

import { actorContextFromHeaders } from '../auth/actor-context';
import { type RunControlDto, runControlSchema, type RunInputDto, runInputSchema } from '../delivery/dto';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { RunControlService } from './run-control.service';

@Controller()
export class RunSessionsController {
  constructor(@Inject(RunControlService) private readonly runControlService: RunControlService) {}

  @Get('run-sessions/:runSessionId')
  getRunSession(@Param('runSessionId') runSessionId: string) {
    return this.runControlService.getRunSession(runSessionId);
  }

  @Get('run-sessions/:runSessionId/events')
  listRunEvents(
    @Param('runSessionId') runSessionId: string,
    @Query('after') after: string | undefined,
    @Query('stream_token') streamToken: string | undefined,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.runControlService.listRunEvents(runSessionId, {
      ...(after === undefined ? {} : { after }),
      ...(streamToken === undefined ? {} : { streamToken }),
      actorContext: actorContextFromHeaders(headers),
    });
  }

  @Sse('run-sessions/:runSessionId/events/stream')
  streamRunEvents(
    @Param('runSessionId') runSessionId: string,
    @Query('after') after: string | undefined,
    @Query('stream_token') streamToken: string | undefined,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<Observable<MessageEvent>> {
    return this.runControlService.streamRunEvents(runSessionId, {
      ...(after === undefined ? {} : { after }),
      ...(streamToken === undefined ? {} : { streamToken }),
      actorContext: actorContextFromHeaders(headers),
    });
  }

  @Post('run-sessions/:runSessionId/events/stream-token')
  createRunEventStreamToken(
    @Param('runSessionId') runSessionId: string,
    @Headers() headers?: Record<string, string | string[] | undefined>,
  ) {
    return this.runControlService.createRunEventStreamToken(runSessionId, actorContextFromHeaders(headers ?? {}));
  }

  @Post('run-sessions/:runSessionId/input')
  sendRunInput(
    @Param('runSessionId') runSessionId: string,
    @Body(new ZodValidationPipe(runInputSchema)) body: RunInputDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.runControlService.createRunInputCommand(runSessionId, body, actorContextFromHeaders(headers));
  }

  @Post('run-sessions/:runSessionId/cancel')
  cancelRun(
    @Param('runSessionId') runSessionId: string,
    @Body(new ZodValidationPipe(runControlSchema)) body: RunControlDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.runControlService.createRunCancelCommand(runSessionId, body, actorContextFromHeaders(headers));
  }

  @Post('run-sessions/:runSessionId/resume')
  resumeRun(
    @Param('runSessionId') runSessionId: string,
    @Body(new ZodValidationPipe(runControlSchema)) body: RunControlDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.runControlService.createRunResumeCommand(runSessionId, body, actorContextFromHeaders(headers));
  }
}
