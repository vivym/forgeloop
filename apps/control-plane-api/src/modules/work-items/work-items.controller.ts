import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';

import {
  createWorkItemSchema,
  updateWorkItemSchema,
  type CreateWorkItemDto,
  type UpdateWorkItemDto,
} from '../delivery/dto';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { WorkItemService } from './work-item.service';
import { workItemTypeMetadata } from './work-item-types';

@Controller()
export class WorkItemsController {
  constructor(@Inject(WorkItemService) private readonly workItemService: WorkItemService) {}

  @Get('work-item-types')
  listWorkItemTypes() {
    return workItemTypeMetadata;
  }

  @Post('work-items')
  createWorkItem(@Body(new ZodValidationPipe(createWorkItemSchema)) body: CreateWorkItemDto) {
    return this.workItemService.createWorkItem(body);
  }

  @Get('work-items')
  listWorkItems(@Query('project_id') projectId?: string) {
    return this.workItemService.listWorkItems(projectId);
  }

  @Get('work-items/:workItemId')
  getWorkItem(@Param('workItemId') workItemId: string) {
    return this.workItemService.getWorkItem(workItemId);
  }

  @Patch('work-items/:workItemId')
  updateWorkItem(
    @Param('workItemId') workItemId: string,
    @Body(new ZodValidationPipe(updateWorkItemSchema)) body: UpdateWorkItemDto,
  ) {
    return this.workItemService.updateWorkItem(workItemId, body);
  }
}
