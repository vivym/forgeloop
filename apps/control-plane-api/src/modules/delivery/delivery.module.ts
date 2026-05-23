import { Module } from '@nestjs/common';

import { AttachmentsModule } from '../attachments/attachments.module';
import { ExecutionPackagesModule } from '../execution-packages/execution-packages.module';
import { MarkdownModule } from '../markdown/markdown.module';
import { ProjectsModule } from '../projects/projects.module';
import { ReviewEvidenceModule } from '../review-evidence/review-evidence.module';
import { RunControlModule } from '../run-control/run-control.module';
import { SpecPlanModule } from '../spec-plan/spec-plan.module';
import { WorkItemsModule } from '../work-items/work-items.module';

@Module({
  imports: [
    ProjectsModule,
    WorkItemsModule,
    SpecPlanModule,
    ExecutionPackagesModule,
    RunControlModule,
    ReviewEvidenceModule,
    AttachmentsModule,
    MarkdownModule,
  ],
})
export class DeliveryModule {}
