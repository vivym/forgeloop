import { Controller, Inject, Param, Post } from '@nestjs/common';

import { RunControlService } from './run-control.service';

@Controller()
export class ExecutionPackageRunsController {
  constructor(@Inject(RunControlService) private readonly runControlService: RunControlService) {}

  @Post('execution-packages/:packageId/run')
  rejectRetiredExecutionPackageRun(@Param('packageId') packageId: string) {
    return this.runControlService.rejectRetiredExecutionPackageStart(packageId, 'run');
  }

  @Post('execution-packages/:packageId/rerun')
  rejectRetiredExecutionPackageRerun(@Param('packageId') packageId: string) {
    return this.runControlService.rejectRetiredExecutionPackageStart(packageId, 'rerun');
  }

  @Post('execution-packages/:packageId/force-rerun')
  rejectRetiredExecutionPackageForceRerun(@Param('packageId') packageId: string) {
    return this.runControlService.rejectRetiredExecutionPackageStart(packageId, 'force_rerun');
  }
}
