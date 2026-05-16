import { Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';

import { actorContextFromHeaders } from '../auth/actor-context';
import {
  createExecutionPackageSchema,
  markPackageReadySchema,
  patchExecutionPackageSchema,
  type CreateExecutionPackageDto,
  type MarkPackageReadyDto,
  type PatchExecutionPackageDto,
} from '../delivery/dto';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { ExecutionPackageService } from './execution-package.service';

@Controller()
export class ExecutionPackagesController {
  constructor(private readonly service: ExecutionPackageService) {}

  @Post('plan-revisions/:planRevisionId/generate-packages')
  generatePackages(@Param('planRevisionId') planRevisionId: string) {
    return this.service.generatePackages(planRevisionId);
  }

  @Post('plan-revisions/:planRevisionId/execution-packages')
  createExecutionPackage(
    @Param('planRevisionId') planRevisionId: string,
    @Body(new ZodValidationPipe(createExecutionPackageSchema)) body: CreateExecutionPackageDto,
  ) {
    return this.service.createExecutionPackage(planRevisionId, body);
  }

  @Get('work-items/:workItemId/execution-packages')
  listExecutionPackages(@Param('workItemId') workItemId: string) {
    return this.service.listExecutionPackages(workItemId);
  }

  @Get('execution-packages/:packageId')
  getExecutionPackage(@Param('packageId') packageId: string) {
    return this.service.getExecutionPackage(packageId);
  }

  @Patch('execution-packages/:packageId')
  patchExecutionPackage(
    @Param('packageId') packageId: string,
    @Body(new ZodValidationPipe(patchExecutionPackageSchema)) body: PatchExecutionPackageDto,
  ) {
    return this.service.patchExecutionPackage(packageId, body);
  }

  @Post('execution-packages/:packageId/mark-ready')
  markPackageReady(
    @Param('packageId') packageId: string,
    @Body(new ZodValidationPipe(markPackageReadySchema)) body: MarkPackageReadyDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.markPackageReady(packageId, body, actorContextFromHeaders(headers));
  }
}
