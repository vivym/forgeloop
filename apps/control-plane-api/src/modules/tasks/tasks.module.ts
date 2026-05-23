import { Module } from '@nestjs/common';

import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { ExecutionPackagesModule } from '../execution-packages/execution-packages.module';
import { MarkdownModule } from '../markdown/markdown.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [ControlPlaneCoreModule, MarkdownModule, ExecutionPackagesModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
