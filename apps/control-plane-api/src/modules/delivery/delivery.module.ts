import { Module } from '@nestjs/common';

import { ProjectsModule } from '../projects/projects.module';
import { WorkItemsModule } from '../work-items/work-items.module';

@Module({
  imports: [ProjectsModule, WorkItemsModule],
})
export class DeliveryModule {}
