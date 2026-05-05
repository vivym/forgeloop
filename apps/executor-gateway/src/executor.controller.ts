import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';

import { ExecutorService } from './executor.service.js';

@Controller('internal/executions')
export class ExecutorController {
  constructor(@Inject(ExecutorService) private readonly service: ExecutorService) {}

  @Post()
  createExecution(@Body() body: unknown) {
    return this.service.createExecution(body);
  }

  @Get(':executionId')
  getExecution(@Param('executionId') executionId: string) {
    return this.service.getExecution(executionId);
  }
}
