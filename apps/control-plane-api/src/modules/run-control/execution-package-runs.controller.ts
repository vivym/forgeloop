import { Body, Controller, Headers, Inject, Param, Post } from '@nestjs/common';

import { actorContextFromHeaders } from '../auth/actor-context';
import { type RunPackageDto, runPackageSchema } from '../delivery/dto';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { RunControlService } from './run-control.service';

@Controller()
export class ExecutionPackageRunsController {
  constructor(@Inject(RunControlService) private readonly runControlService: RunControlService) {}

  @Post('execution-packages/:packageId/run')
  runPackage(
    @Param('packageId') packageId: string,
    @Body(new ZodValidationPipe(runPackageSchema)) body: RunPackageDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.runControlService.runPackage(packageId, body, 'run', actorContextFromHeaders(headers));
  }

  @Post('execution-packages/:packageId/rerun')
  rerunPackage(
    @Param('packageId') packageId: string,
    @Body(new ZodValidationPipe(runPackageSchema)) body: RunPackageDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.runControlService.runPackage(packageId, body, 'rerun', actorContextFromHeaders(headers));
  }

  @Post('execution-packages/:packageId/force-rerun')
  forceRerunPackage(
    @Param('packageId') packageId: string,
    @Body(new ZodValidationPipe(runPackageSchema)) body: RunPackageDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.runControlService.runPackage(packageId, body, 'force_rerun', actorContextFromHeaders(headers));
  }
}
