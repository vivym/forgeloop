import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { ProjectsModule } from '../projects/projects.module';
import { WorkItemsController } from './work-items.controller';
import { WorkItemService } from './work-item.service';

@Module({
  imports: [ControlPlaneCoreModule, AuditModule, ProjectsModule],
  controllers: [WorkItemsController],
  providers: [WorkItemService],
  exports: [WorkItemService],
})
export class WorkItemsModule {}
