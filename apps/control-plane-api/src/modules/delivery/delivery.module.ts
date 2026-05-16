import { Module } from '@nestjs/common';

import { ExecutionPackagesModule } from '../execution-packages/execution-packages.module';
import { ProjectsModule } from '../projects/projects.module';
import { SpecPlanModule } from '../spec-plan/spec-plan.module';
import { WorkItemsModule } from '../work-items/work-items.module';

@Module({
  imports: [ProjectsModule, WorkItemsModule, SpecPlanModule, ExecutionPackagesModule],
})
export class DeliveryModule {}
