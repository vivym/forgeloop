import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { ExecutionPackagesModule } from '../execution-packages/execution-packages.module';
import { RunControlModule } from '../run-control/run-control.module';
import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';

@Module({
  imports: [ControlPlaneCoreModule, AuditModule, ExecutionPackagesModule, RunControlModule],
  controllers: [ExecutionsController],
  providers: [ExecutionsService],
  exports: [ExecutionsService],
})
export class ExecutionsModule {}
