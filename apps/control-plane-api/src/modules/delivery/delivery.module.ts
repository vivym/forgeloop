import { Module } from '@nestjs/common';

import { AttachmentsModule } from '../attachments/attachments.module';
import { BrainstormingModule } from '../brainstorming/brainstorming.module';
import { ExecutionPackagesModule } from '../execution-packages/execution-packages.module';
import { DevelopmentPlansModule } from '../development-plans/development-plans.module';
import { MarkdownModule } from '../markdown/markdown.module';
import { ProjectsModule } from '../projects/projects.module';
import { ReviewEvidenceModule } from '../review-evidence/review-evidence.module';
import { RunControlModule } from '../run-control/run-control.module';
import { SpecPlanModule } from '../spec-plan/spec-plan.module';
import { TasksModule } from '../tasks/tasks.module';
import { WorkItemsModule } from '../work-items/work-items.module';

@Module({
  imports: [
    ProjectsModule,
    WorkItemsModule,
    DevelopmentPlansModule,
    BrainstormingModule,
    SpecPlanModule,
    ExecutionPackagesModule,
    RunControlModule,
    ReviewEvidenceModule,
    AttachmentsModule,
    MarkdownModule,
    TasksModule,
  ],
})
export class DeliveryModule {}
