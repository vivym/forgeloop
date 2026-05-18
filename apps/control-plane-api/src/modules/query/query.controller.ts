import { Controller, Get, Inject, Param, Query } from '@nestjs/common';

import { QueryService } from './query.service';

@Controller('query')
export class QueryController {
  constructor(@Inject(QueryService) private readonly service: QueryService) {}

  @Get('work-item-cockpit/:workItemId')
  getWorkItemCockpit(@Param('workItemId') workItemId: string) {
    return this.service.getWorkItemCockpit(workItemId);
  }

  @Get('release-cockpit/:releaseId')
  getReleaseCockpit(@Param('releaseId') releaseId: string) {
    return this.service.getReleaseCockpit(releaseId);
  }

  @Get('workbenches/intake')
  getIntakeWorkbench(@Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getRoleWorkbench('intake', query);
  }

  @Get('workbenches/spec-approver')
  getSpecApproverWorkbench(@Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getRoleWorkbench('spec-approver', query);
  }

  @Get('workbenches/execution-owner')
  getExecutionOwnerWorkbench(@Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getRoleWorkbench('execution-owner', query);
  }

  @Get('workbenches/reviewer')
  getReviewerWorkbench(@Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getRoleWorkbench('reviewer', query);
  }

  @Get('workbenches/qa-test-owner')
  getQaTestOwnerWorkbench(@Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getRoleWorkbench('qa-test-owner', query);
  }

  @Get('workbenches/release-owner')
  getReleaseOwnerWorkbench(@Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getRoleWorkbench('release-owner', query);
  }

  @Get('workbenches/manager-health')
  getManagerHealthWorkbench(@Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getRoleWorkbench('manager-health', query);
  }

  @Get('replay/:objectType/:objectId')
  getReplay(@Param('objectType') objectType: string, @Param('objectId') objectId: string) {
    return this.service.getReplay(objectType, objectId);
  }
}
