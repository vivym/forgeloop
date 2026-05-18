import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { ExecutionPackagesController } from './execution-packages.controller';
import { ExecutionPackageService } from './execution-package.service';

@Module({
  imports: [ControlPlaneCoreModule, AuditModule],
  controllers: [ExecutionPackagesController],
  providers: [ExecutionPackageService],
  exports: [ExecutionPackageService],
})
export class ExecutionPackagesModule {}
