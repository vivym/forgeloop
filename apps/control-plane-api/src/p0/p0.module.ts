import { Module } from '@nestjs/common';

import { AutomationModule } from '../modules/automation/automation.module';
import { ControlPlaneCoreModule } from '../modules/core/control-plane-core.module';
import { ExecutionPackagesModule } from '../modules/execution-packages/execution-packages.module';
import { ProjectsModule } from '../modules/projects/projects.module';
import { RunControlModule } from '../modules/run-control/run-control.module';
import { SpecPlanModule } from '../modules/spec-plan/spec-plan.module';
import { WorkItemsModule } from '../modules/work-items/work-items.module';
import { P0Controller } from './p0.controller';
import { P0Service } from './p0.service';

@Module({
  imports: [
    ControlPlaneCoreModule,
    AutomationModule,
    ProjectsModule,
    WorkItemsModule,
    SpecPlanModule,
    ExecutionPackagesModule,
    RunControlModule,
  ],
  controllers: [P0Controller],
  providers: [P0Service],
})
export class P0Module {}
