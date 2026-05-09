import { Controller, Get, Param } from '@nestjs/common';

import { QueryService } from './query.service';

@Controller('query')
export class QueryController {
  constructor(private readonly service: QueryService) {}

  @Get('work-item-cockpit/:workItemId')
  getWorkItemCockpit(@Param('workItemId') workItemId: string) {
    return this.service.getWorkItemCockpit(workItemId);
  }

  @Get('replay/:objectType/:objectId')
  getReplay(@Param('objectType') objectType: string, @Param('objectId') objectId: string) {
    return this.service.getReplay(objectType, objectId);
  }
}
