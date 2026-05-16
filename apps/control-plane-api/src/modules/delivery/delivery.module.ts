import { Module } from '@nestjs/common';

import { ProjectsModule } from '../projects/projects.module';
import { SpecPlanModule } from '../spec-plan/spec-plan.module';
import { WorkItemsModule } from '../work-items/work-items.module';

@Module({
  imports: [ProjectsModule, WorkItemsModule, SpecPlanModule],
})
export class DeliveryModule {}
